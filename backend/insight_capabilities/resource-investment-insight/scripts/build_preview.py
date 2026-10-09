"""Build a self-contained, offline rendering reference from local synthetic fixtures."""
import argparse
import importlib.util
import json
from pathlib import Path


def build(root: Path, output: Path | None = None) -> Path:
    root = root.resolve()
    examples_dir = root / 'examples'
    catalog = json.loads((examples_dir / 'catalog.json').read_text(encoding='utf-8-sig'))
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8-sig'))
    examples = []

    def read_fixture(name):
        path = (examples_dir / name).resolve()
        if not path.is_relative_to(examples_dir.resolve()):
            raise ValueError('Fixture must stay inside examples/: ' + str(name))
        return json.loads(path.read_text(encoding='utf-8-sig'))

    for item in catalog['examples']:
        examples.append({'id': item['id'], 'label': item['label'], 'source_mode': 'fixture', 'preset_config': manifest['presets'],
                         'evidence': read_fixture(item['evidence']),
                         'results': {key: read_fixture(value) for key, value in item['results'].items()}})
    return write_preview(root, examples, output)


def write_preview(root: Path, examples: list, output: Path | None = None) -> Path:
    # JSON script contents cannot terminate the enclosing script, including malicious fixture text.
    payload = json.dumps(examples, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    template = (root / 'assets' / 'preview.template.html').read_text(encoding='utf-8')
    if template.count('__INSIGHT_EXAMPLES__') != 1:
        raise ValueError('Template must contain exactly one data placeholder')
    destination = output or root / 'preview.html'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(template.replace('__INSIGHT_EXAMPLES__', payload), encoding='utf-8')
    return destination


def build_imported(root: Path, evidence_path: Path, result_path: Path,
                   preset: str | None = None, output: Path | None = None) -> Path:
    """Validate local result files with the pack runtime before rendering; never call a model."""
    root = root.resolve()
    spec = importlib.util.spec_from_file_location('preview_insight_runtime', root / 'scripts' / 'insight_pack.py')
    if spec is None or spec.loader is None:
        raise ValueError('Cannot load InsightPack runtime')
    runtime = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runtime)
    pack = runtime.InsightPack(root)
    evidence = runtime.load_json(evidence_path)
    supplied = runtime.load_json(result_path)
    if not isinstance(supplied, dict):
        raise runtime.PackError('Result file must contain a JSON object')
    result = supplied.get('result', supplied)
    if not isinstance(result, dict):
        raise runtime.PackError('Wrapped result must be a JSON object')
    selected = preset or result.get('preset_id')
    pack.validate_result(result, evidence, selected)
    metadata = supplied.get('metadata', {}) if 'result' in supplied else {}
    if not isinstance(metadata, dict):
        raise runtime.PackError('Metadata must be a JSON object')
    example = {'id': 'local-result', 'label': '本地测试结果', 'source_mode': 'local',
               'metadata': metadata, 'preset_config': pack.manifest()['presets'],
               'evidence': evidence, 'results': {selected: result}}
    return write_preview(root, [example], output or root / 'out' / 'model-preview.html')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path)
    parser.add_argument('--evidence', type=Path, help='Local evidence JSON; requires --result')
    parser.add_argument('--result', type=Path, help='Raw result or {metadata, usage, result} JSON')
    parser.add_argument('--preset', help='Optional preset ID; defaults to result.preset_id')
    args = parser.parse_args()
    if bool(args.evidence) != bool(args.result):
        parser.error('--evidence and --result must be supplied together')
    if args.preset and not args.result:
        parser.error('--preset requires --evidence and --result')
    if args.result:
        print(build_imported(args.root, args.evidence, args.result, args.preset, args.output))
    else:
        print(build(args.root, args.output))
