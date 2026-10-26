"""User-operated password setup. Never print the password or its hash."""
import getpass
import os
from pathlib import Path
from secrets import token_urlsafe
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from webapp.personal_access import hash_password


def main():
    print('Set the one password for your personal PrimusLab journal.')
    print('Use 16–128 characters. Nothing appears while you type.')
    password = getpass.getpass('New password: ')
    confirm = getpass.getpass('Type it again: ')
    if password != confirm:
        raise ValueError('The passwords do not match. Run the helper again.')
    encoded = hash_password(password)
    directory = ROOT / 'data' / 'private'
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / 'personal-login.env'
    if path.exists():
        answer = input('Replace the previously saved login configuration? Type REPLACE: ')
        if answer != 'REPLACE':
            print('Existing configuration kept.')
            return
    fd = os.open(path, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(f"PRIMUSLAB_PASSWORD_HASH='{encoded}'\n")
        output.write(f"PRIMUSLAB_SESSION_SECRET='{token_urlsafe(48)}'\n")
    print(f'Login configuration saved privately to: {path}')
    print('Keep this file private. Import it in the host Environment settings when deploying.')
    print('Your password itself was not saved. Changing the host values signs out existing sessions.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, EOFError, KeyboardInterrupt) as exc:
        print(str(exc) or 'Setup cancelled.')
        sys.exit(1)
