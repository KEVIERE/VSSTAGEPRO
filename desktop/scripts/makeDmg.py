#!/usr/bin/env python3
"""Monta o .dmg com a janela "arraste para Aplicativos" fora de um Mac.

Uso: makeDmg.py <VS Stage.app> <fundo.png> <saida.dmg> <nome do volume>
Se existir <fundo>@2x.png ao lado, os dois viram um .tiff para a tela Retina (precisa do ImageMagick).
Ferramentas (variáveis de ambiente): VS_MKFS_HFSPLUS (hfsprogs), VS_HFSFILL (scripts/hfsFill.c), VS_DMG (libdmg-hfsplus).
Python: pip install ds_store mac_alias
"""
import datetime
import json
import os
import struct
import subprocess
import sys
import tempfile

from ds_store import DSStore
from mac_alias import ALIAS_FIXED_DISK, ALIAS_KIND_FILE, Alias, TargetInfo, VolumeInfo

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build', 'dmg-layout.json')) as _f:
    _LAYOUT = json.load(_f)
WINDOW = tuple(_LAYOUT['window'])
ICON_SIZE = _LAYOUT['iconSize']
APP_POS = tuple(_LAYOUT['app'])
APPS_POS = tuple(_LAYOUT['applications'])


def run_fill(image, lines):
    out = subprocess.run([os.environ['VS_HFSFILL'], image], input='\n'.join(lines) + '\n',
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(out.stderr)
    return out.stdout


def app_entries(app, dest):
    lines = [f'D\t{dest}\t{os.stat(app).st_mode & 0o7777:o}']
    for root, dirs, files in os.walk(app):
        rel = os.path.relpath(root, app)
        base = dest if rel == '.' else f'{dest}/{rel}'
        for name in sorted(dirs + files):
            src = os.path.join(root, name)
            target = f'{base}/{name}'
            if os.path.islink(src):
                lines.append(f'L\t{target}\t{os.readlink(src)}')
            elif os.path.isdir(src):
                lines.append(f'D\t{target}\t{os.stat(src).st_mode & 0o7777:o}')
            else:
                lines.append(f'F\t{target}\t{os.stat(src).st_mode & 0o7777:o}\t{src}')
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
    return lines


def volume_created(image):
    with open(image, 'rb') as f:
        f.seek(1024 + 16)
        seconds = struct.unpack('>I', f.read(4))[0]
    return datetime.datetime(1904, 1, 1, tzinfo=datetime.timezone.utc) + datetime.timedelta(seconds=seconds)


def retina_background(background, tmp):
    hidpi = background[:-4] + '@2x.png'
    if not (background.endswith('.png') and os.path.exists(hidpi)):
        return background
    out = os.path.join(tmp, 'background.tiff')
    frames = []
    for src, dpi in ((background, 72), (hidpi, 144)):
        frames.append(os.path.join(tmp, f'bg{dpi}.tiff'))
        subprocess.run(['convert', src, '-units', 'PixelsPerInch', '-density', str(dpi), frames[-1]], check=True)
    subprocess.run(['convert', *frames, '-compress', 'lzw', out], check=True)
    return out


def background_alias(volume, created, folder_cnid, file_cnid, name):
    target = TargetInfo(ALIAS_KIND_FILE, name, folder_cnid, file_cnid, created, b'\0\0\0\0', b'\0\0\0\0')
    target.folder_name = '.background'
    target.posix_path = f'/.background/{name}'
    target.carbon_path = f'{volume}:.background:\0{name}'
    target.cnid_path = [folder_cnid]
    vol = VolumeInfo(volume, created, b'H+', ALIAS_FIXED_DISK, 0, b'\0\0')
    vol.posix_path = f'/Volumes/{volume}'
    return Alias(volume=vol, target=target).to_bytes()


def write_ds_store(path, app_name, alias):
    w, h = WINDOW
    with DSStore.open(path, 'w+') as d:
        d['.']['vSrn'] = ('long', 1)
        d['.']['icvl'] = ('type', b'icnv')
        d['.']['bwsp'] = {
            'WindowBounds': f'{{{{200, 120}}, {{{w}, {h + 22}}}}}',
            'ShowStatusBar': False, 'ShowToolbar': False, 'ShowPathbar': False, 'ShowTabView': False,
            'ShowSidebar': False, 'ContainerShowSidebar': False, 'PreviewPaneVisibility': False, 'SidebarWidth': 0,
        }
        d['.']['icvp'] = {
            'viewOptionsVersion': 1, 'backgroundType': 2, 'backgroundImageAlias': alias,
            'backgroundColorRed': 0.0, 'backgroundColorGreen': 0.0, 'backgroundColorBlue': 0.0,
            'gridOffsetX': 0.0, 'gridOffsetY': 0.0, 'gridSpacing': 100.0, 'arrangeBy': 'none',
            'showIconPreview': True, 'showItemInfo': False, 'labelOnBottom': True,
            'textSize': 13.0, 'iconSize': float(ICON_SIZE), 'scrollPositionX': 0.0, 'scrollPositionY': 0.0,
        }
        d[app_name]['Iloc'] = APP_POS
        d['Applications']['Iloc'] = APPS_POS
        d['.background']['Iloc'] = (w + 200, 100)
        d['.VolumeIcon.icns']['Iloc'] = (w + 200, 250)


def main():
    app, background, out, volume = sys.argv[1:5]
    app_name = os.path.basename(app.rstrip('/'))
    total = sum(os.lstat(os.path.join(r, f)).st_size + 8192 for r, _, fs in os.walk(app) for f in fs)
    size_mb = int(total * 1.1 / 1048576) + 32

    with tempfile.TemporaryDirectory() as tmp:
        image = os.path.join(tmp, 'volume.hfs')
        with open(image, 'wb') as f:
            f.truncate(size_mb * 1048576)
        subprocess.run([os.environ['VS_MKFS_HFSPLUS'], '-v', volume, image], check=True, capture_output=True)

        background = retina_background(background, tmp)
        bg_name = 'background' + os.path.splitext(background)[1]
        volume_icon = os.path.join(app, 'Contents', 'Resources', 'icon.icns')
        run_fill(image, app_entries(app, f'/{app_name}') + [
            'L\t/Applications\t/Applications',
            'D\t/.background\t755',
            f'F\t/.background/{bg_name}\t644\t{os.path.abspath(background)}',
            f'F\t/.VolumeIcon.icns\t644\t{volume_icon}',
            'C\t/',
        ])
        ids = dict(line.split('\t')[::-1] for line in
                   run_fill(image, ['I\t/.background', f'I\t/.background/{bg_name}']).splitlines())

        links = [l.split('\t') for l in app_entries(app, f'/{app_name}') if l.startswith('L\t')] + [['L', '/Applications', '/Applications']]
        stored = dict(line.split('\t')[::-1] for line in run_fill(image, [f'R\t{p}' for _, p, _ in links]).splitlines())
        broken = [p for _, p, t in links if stored.get(p) != t]
        if broken:
            sys.exit(f'Links quebrados no volume: {broken}')

        ds = os.path.join(tmp, 'DS_Store')
        alias = background_alias(volume, volume_created(image), int(ids['/.background']),
                                 int(ids[f'/.background/{bg_name}']), bg_name)
        write_ds_store(ds, app_name, alias)
        run_fill(image, [f'F\t/.DS_Store\t644\t{ds}'])

        subprocess.run([os.environ['VS_DMG'], 'build', image, out], check=True, capture_output=True)


if __name__ == '__main__':
    main()
