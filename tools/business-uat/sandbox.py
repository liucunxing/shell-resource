"""Launch the release under test on loopback with a fresh, disposable synthetic database.

The orchestrator keeps a pipe to stdin open. Closing that pipe gracefully stops the
server, disposes SQLite connections and removes the temporary directory.
"""

import argparse
import asyncio
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

sys.dont_write_bytecode = True
from sandbox_inputs import apply_roster, population, prepare_open_version

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
DEFAULT_FIXTURE = BACKEND / "tests" / "fixtures" / "v19_prototype_demo.json"


def file_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree_digest(folder):
    digest = hashlib.sha256()
    for path in sorted(folder.rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(folder).as_posix().encode() + b"\0")
            digest.update(bytes.fromhex(file_digest(path)))
    return digest.hexdigest()


def deny_outbound(event, args):
    # Uvicorn accepts incoming loopback connections. The application never needs
    # to initiate a connection, resolve a name or launch a child executable.
    if event in {
        "socket.connect", "socket.sendto", "socket.getaddrinfo", "socket.gethostbyname",
        "socket.gethostbyaddr", "subprocess.Popen", "os.system", "os.posix_spawn",
    }:
        raise PermissionError("Outbound connections and child processes are disabled in UAT")


@contextmanager
def confine_writes(temporary, report_files):
    # Register before any business modules are imported. SQLite uses the two
    # explicitly supplied temporary paths; Python file writes are checked here.
    active = True

    def guard(event, args):
        if not active:
            return
        if event == "open":
            if not args[2] & (os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC):
                return
            paths = args[:1]
        elif event in {"os.mkdir", "os.remove", "os.rmdir", "os.truncate", "os.chmod", "os.utime"}:
            paths = args[:1]
        elif event in {"os.rename", "os.link"}:
            paths = args[:2]
        elif event == "os.symlink":
            raise PermissionError("UAT process may not create symbolic links")
        else:
            return
        for raw in paths:
            if isinstance(raw, int):  # a previously opened descriptor
                continue
            path = Path(os.fsdecode(raw)).resolve()
            if not path.is_relative_to(temporary) and path not in report_files:
                raise PermissionError("UAT file writes are restricted to disposable test data")

    sys.addaudithook(guard)
    try:
        yield
    finally:
        # TemporaryDirectory handles its own cleanup using directory-relative fds.
        active = False


def publish_manifest(path, temporary, manifest):
    # Readers see a complete document or no document. Never overwrite an earlier run.
    with temporary.open("x", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    try:
        os.link(temporary, path)
    finally:
        temporary.unlink()


async def serve(args, temporary, staging_file, commit):
    # Configure the application's normal engine, not just a request dependency:
    # every app session uses this database, including sessions opened internally.
    sys.path[:0] = [str(BACKEND), str(BACKEND / "src")]
    from app.core import config

    settings = config.Settings(
        app_env="test",
        database_url="sqlite+aiosqlite:///" + (temporary / "main.sqlite").as_posix(),
        serve_frontend=True,
        frontend_dist_path=str(args.frontend_dist),
        docs_enabled=False,
    )
    config.get_settings = lambda: settings
    sys.addaudithook(deny_outbound)

    import uvicorn
    from app.db.session import AsyncSessionFactory, engine
    from app.main import app
    from app.models.do import BaseDO, BudgetDO
    from sqlalchemy import event, select
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    from tests.local_preview import install_local_preview
    from tests.v19_prototype_seed import load_prototype, preview_users
    from tests.v20_prototype_seed import seed_v20_prototype

    @event.listens_for(engine.sync_engine, "connect")
    def attach_data(connection, _):
        connection.execute("ATTACH DATABASE ? AS data", (str(temporary / "data.sqlite"),))

    try:
        fixture = load_prototype(args.fixture)
        if args.roster:
            apply_roster(fixture, json.loads(args.roster.read_text(encoding="utf-8-sig")))
        version = prepare_open_version(fixture)
        async with engine.begin() as connection:
            await connection.run_sync(BaseDO.metadata.create_all)
        async with AsyncSessionFactory() as session:
            await seed_v20_prototype(session, fixture)
            rows = await session.execute(
                select(BudgetDO.initiative_key, BudgetDO.id)
                .where(BudgetDO.planning_version_id == version["id"])
            )
            users = population(fixture, version, dict(rows.all()))
        choices, default = preview_users(fixture)
        install_local_preview(
            app, args.frontend_dist, users=choices, default_email=default,
            data_label="业务验收 · 一次性合成数据",
        )
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1"])
        run_id = uuid.uuid4().hex

        @app.middleware("http")
        async def local_only(request, call_next):
            response = await call_next(request)
            response.headers["X-UAT-Run-ID"] = run_id
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                "font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; "
                "base-uri 'self'; form-action 'self'; frame-src 'none'"
            )
            return response

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            server = uvicorn.Server(uvicorn.Config(
                app, host="127.0.0.1", port=port, log_level="warning", access_log=False,
                proxy_headers=False,
            ))

            def stop_on_parent_exit():
                sys.stdin.buffer.read(1)
                server.should_exit = True

            threading.Thread(target=stop_on_parent_exit, daemon=True).start()
            serving = asyncio.create_task(server.serve(sockets=[listener]))
            try:
                while not server.started and not serving.done():
                    await asyncio.sleep(0.04)
                if not server.started:
                    await serving
                    raise RuntimeError("UAT application did not start")
                publish_manifest(args.ready_file, staging_file, {
                    "baseUrl": f"http://127.0.0.1:{port}", "runId": run_id,
                    "versionId": version["id"], "users": users, "sourceCommit": commit,
                    "fixtureSha256": file_digest(args.fixture),
                    "frontendSha256": tree_digest(args.frontend_dist),
                    "rosterSource": "custom" if args.roster else "fixture",
                    "rosterSha256": file_digest(args.roster) if args.roster else None,
                    "identityMode": "local-synthetic", "database": "temporary SQLite",
                    "preparation": "仅在内存输入副本中移除启用版本的草稿和提交，保留历史版本和项目归属",
                })
                await serving
            finally:
                server.should_exit = True
                await serving
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ready-file", type=Path, required=True)
    parser.add_argument("--frontend-dist", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--roster", type=Path)
    args = parser.parse_args()
    args.frontend_dist = args.frontend_dist.resolve(strict=True)
    if not (args.frontend_dist / "index.html").is_file():
        parser.error("frontend-dist must contain the release's built index.html")
    if args.ready_file.exists() or not args.ready_file.parent.is_dir():
        parser.error("ready-file must be a new path in an existing run directory")
    args.ready_file = args.ready_file.resolve()
    staging_file = args.ready_file.with_name(f".uat-ready-{uuid.uuid4().hex}.tmp")
    commit = subprocess.check_output(
        ["git", "-C", str(ROOT), "rev-parse", "--verify", "HEAD"], text=True
    ).strip()
    with tempfile.TemporaryDirectory(prefix="resource-uat-db-") as directory:
        temporary = Path(directory).resolve()
        with confine_writes(temporary, {args.ready_file, staging_file}):
            asyncio.run(serve(args, temporary, staging_file, commit))


if __name__ == "__main__":
    main()
