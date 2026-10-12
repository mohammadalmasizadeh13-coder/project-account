"""Build the Windows folder; source data is never included unless requested."""

import argparse
from contextlib import closing
from datetime import datetime, timezone
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import sqlite3
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent


def snapshot_database(source, destination):
    """SQLite's backup API includes committed WAL data while the source is live."""
    source = Path(source).resolve(strict=True)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError(f'Refusing to overwrite database: {destination}')
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as reader:
        with closing(sqlite3.connect(destination)) as writer:
            reader.backup(writer)
            if writer.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                raise RuntimeError('The copied database failed its integrity check.')
            # Browser sessions are local to the original device; accounts/passwords remain.
            for table in ('noor_sessions', 'noor_login_attempts'):
                exists = writer.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
                if exists:
                    writer.execute(f'DELETE FROM {table}')
            writer.commit()
            writer.execute('PRAGMA wal_checkpoint(TRUNCATE)')


def current_data_paths():
    from dotenv import dotenv_values
    from sqlalchemy.engine import make_url

    backend = ROOT / 'backend'
    config = dotenv_values(backend / '.env', interpolate=False)
    url = make_url(config.get('DATABASE_URL') or f'sqlite:///{(backend / "zarnegaar.db").as_posix()}')
    if url.get_backend_name() != 'sqlite' or not url.database or url.database == ':memory:':
        raise RuntimeError('Portable account transfer requires a local SQLite database.')
    source = Path(url.database)
    if not source.is_absolute():
        source = backend / source
    uploads = Path(config.get('NOOR_UPLOAD_DIR') or backend / 'uploads')
    if not uploads.is_absolute():
        uploads = backend / uploads
    return source.resolve(strict=True), uploads.resolve()


def build(output, include_current_data=False):
    if sys.platform != 'win32' or sys.maxsize <= 2**32 or platform.machine().upper() not in ('AMD64', 'X86_64'):
        raise RuntimeError('Build this distribution on 64-bit Windows with 64-bit Python.')
    output = Path(output).resolve()
    archive = output.with_name(output.name + '.zip')
    if output.exists() or archive.exists():
        raise FileExistsError('Output already exists. Choose a new --output directory; existing account data is never overwritten.')
    frontend = ROOT / 'frontend' / 'dist'
    if not (frontend / 'index.html').is_file():
        raise RuntimeError('Build the frontend with npm run build before packaging.')
    source_data = current_data_paths() if include_current_data else None
    work_parent = ROOT / 'artifacts' / 'portable'
    work_parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='build-', dir=work_parent))
    subprocess.run([
        sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--windowed',
        '--name', 'Zarnegar', '--distpath', str(work / 'dist'), '--workpath', str(work / 'work'),
        '--specpath', str(work), '--paths', str(ROOT / 'backend'),
        '--add-data', f'{frontend};frontend', '--collect-submodules', 'uvicorn',
        '--hidden-import', 'sqlalchemy.dialects.sqlite', '--hidden-import', 'sqlalchemy.dialects.sqlite.pysqlite',
        '--exclude-module', 'pytest', '--exclude-module', 'IPython',
        str(ROOT / 'portable' / 'launcher.py'),
    ], check=True, cwd=ROOT, env={**os.environ, 'PYINSTALLER_CONFIG_DIR': str(work_parent / 'cache')})
    staged = work / 'dist' / 'Zarnegar'
    (staged / 'data').mkdir()
    (staged / 'data' / 'uploads').mkdir()
    (staged / 'data' / 'logs').mkdir()
    if source_data:
        database, uploads = source_data
        snapshot_database(database, staged / 'data' / 'zarnegaar.db')
        if uploads.is_dir():
            shutil.copytree(uploads, staged / 'data' / 'uploads', dirs_exist_ok=True)
    shutil.copyfile(ROOT / 'portable' / 'READ-ME.fa.txt', staged / 'READ-ME.fa.txt')
    revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, capture_output=True, check=True).stdout.strip()
    manifest = {
        'application': 'Zarnegar', 'platform': 'Windows x64',
        'builtAt': datetime.now(timezone.utc).isoformat(), 'baseCommit': revision,
        'python': platform.python_version(), 'pyinstaller': importlib.metadata.version('PyInstaller'),
        'includesAccountData': include_current_data,
    }
    (staged / 'build-info.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(staged, output)
    shutil.make_archive(str(output), 'zip', root_dir=output.parent, base_dir=output.name)
    print(f'Portable folder: {output}')
    print(f'Transfer archive: {archive}')
    print('Account data included.' if include_current_data else 'Fresh installation: create an account on first launch.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'Zarnegar-Portable')
    parser.add_argument('--include-current-data', action='store_true')
    options = parser.parse_args()
    build(options.output, options.include_current_data)
