import logging.config


def configure_logging(debug: bool = False, db_echo: bool = False) -> None:
    level = "DEBUG" if debug else "INFO"
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {
                    "format": "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
                }
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "level": level,
                }
            },
            "loggers": {
                "sqlalchemy.engine": {
                    "handlers": ["console"],
                    "level": "INFO" if db_echo else "WARNING",
                    "propagate": False,
                }
            },
            "root": {"handlers": ["console"], "level": level},
        }
    )

