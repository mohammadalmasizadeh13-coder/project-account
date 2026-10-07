"""Generate a password hash; never write or print the password."""
from getpass import getpass

from .security import hash_password


def main():
    password = getpass("رمز مالک (حداقل ۸ نویسه): ")
    confirmation = getpass("تکرار رمز: ")
    if len(password) < 8 or len(password) > 256:
        raise SystemExit("رمز باید بین ۸ تا ۲۵۶ نویسه باشد.")
    if password != confirmation:
        raise SystemExit("تکرار رمز مطابقت ندارد.")
    print(hash_password(password))


if __name__ == "__main__":
    main()
