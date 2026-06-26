from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("plotop")
except PackageNotFoundError:
    __version__ = "unknown"
