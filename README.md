# Wedding Photo Wall

Prywatna strona dla gości weselnych: QR prowadzi do tajnego linku, goście wgrywają zdjęcia z telefonu, a galeria od razu pokazuje dodane kadry.

## Uruchomienie lokalne

```powershell
cd "C:\Users\kamil\OneDrive\Dokumenty\Question Bank\wedding-photo-wall"
node server.js
```

Po starcie serwer wypisze dwa linki:

- `Guest page` - ten link zakoduj w QR dla gości.
- `Admin page` - panel z kodem QR i statystykami galerii; wejście wymaga hasła administratora.

Pierwsze uruchomienie tworzy `data/secrets.json` z losowym linkiem gości, tokenem admina i hasłem administratora. Tego pliku nie wrzucaj publicznie.

## Konfiguracja

Możesz ustawić zmienne środowiskowe:

```powershell
$env:SITE_TITLE="Zdjęcia z wesela Kasi i Michała"
$env:COUPLE_NAMES="Kasia i Michał"
$env:WEDDING_DATE="20 czerwca 2026"
$env:PUBLIC_URL="https://twoja-domena.pl"
$env:ADMIN_PASSWORD="mocne-haslo-admina"
$env:MAX_SINGLE_FILE_BYTES="26214400"
node server.js
```

Na hostingu ustaw szczególnie `PUBLIC_URL`, `WEDDING_TOKEN`, `ADMIN_TOKEN` i `ADMIN_PASSWORD`, żeby QR zawsze prowadził do publicznej domeny, a panel admina miał stałe hasło.

## Ważne przed weselem

- Sam QR nie jest hasłem. Bezpieczeństwo polega na długim, losowym linku w QR; osoba z linkiem może go przekazać dalej.
- Nie wdrażaj tego na Vercel/Netlify jako funkcji serverless, bo uploady na lokalny dysk nie będą trwałe. Wybierz VPS, Railway/Render/Fly z persistent disk albo serwer z podmontowanym wolumenem.
- iPhone czasem zapisuje HEIC. Aplikacja przyjmie HEIC, ale nie każda przeglądarka pokaże podgląd; JPG/PNG/WEBP wyświetlają się normalnie.
