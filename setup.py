from setuptools import setup, find_packages

with open("requirements.txt") as f:
    requirements = f.read().splitlines()

setup(
    name="plotop",
    use_scm_version=True,
    packages=find_packages(include=["server", "server.*"]),
    package_data={
        "server": [
            "templates/*.html",
            "templates/*/*.html",
            "statics/*",
            "statics/*/*"
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