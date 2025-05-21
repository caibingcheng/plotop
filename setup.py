from setuptools import setup, find_packages

with open("requirements.txt") as f:
    requirements = f.read().splitlines()

setup(
    name="plotop",
    version="0.1.0",
    packages=find_packages(include=["server", "server.*", "server.templates", "server.templates.*"]),
    package_data={
        "server": [
            "templates/*.html",
            "templates/*/*.html"
        ]
    },
    install_requires=requirements,
    entry_points={
        "console_scripts": [
            "plotop=server.app:main"
        ]
    },
    python_requires=">=3.8",
    author="caibingcheng",
    author_email="jack_cbc@163.com",
    description="Real-time performance plotting application with Flask"
)