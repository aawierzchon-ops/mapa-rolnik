"""
Odświeża dane dodatku „rolnik” i wbudowuje je w index.html mapy qgis2web.

Uruchamia skrypty z dodatek_rolnik/skrypty (Landsat 8/9, ERA5-Land/ERA5, gleba SoilGrids),
łączy opisy warstw w meta.json, a potem wstawia do <mapa>/index.html jeden blok
(między znacznikami <!-- dodatek rolnik: początek/koniec -->) zawierający:
  - style  dodatek_rolnik/rolnik/rolnik.css,
  - dane   (meta.json + warstwy PNG jako data:image/png;base64) w window.ROLNIK_DANE,
  - skrypt dodatek_rolnik/rolnik/rolnik.js.
Mapa nie potrzebuje więc folderu rolnik/ – wszystko jest w index.html.

  python odswiez_dane_rolnik.py              # Landsat + ERA5 (gleba tylko, gdy jej brak)
  python odswiez_dane_rolnik.py --gleba      # także przelicz glebę (zmienia się rzadko)
  python odswiez_dane_rolnik.py --tylko-wstaw   # bez pobierania, tylko wstaw _dane do index.html
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys

TU = os.path.dirname(os.path.abspath(__file__))
ROLNIK = os.path.join(TU, "dodatek_rolnik")
SKRYPTY = os.path.join(ROLNIK, "skrypty")
DODATEK = os.path.join(ROLNIK, "rolnik")
DANE = os.path.join(ROLNIK, "_dane")
MAPA = TU   # index.html mapy leży obok tego skryptu

POCZATEK = "<!-- dodatek rolnik: początek -->"
KONIEC = "<!-- dodatek rolnik: koniec -->"
PO_SKRYPCIE = '<script src="./resources/parcel-search.js"></script>'


def uruchom(skrypt, *arg):
    print(f"\n=== {skrypt} {' '.join(arg)}")
    subprocess.run([sys.executable, os.path.join(SKRYPTY, skrypt), *arg], check=True,
                   env={**os.environ, "PYTHONIOENCODING": "utf-8"})


def czytaj(sciezka):
    with open(sciezka, encoding="utf-8") as f:
        return f.read()


def bezpieczny_skrypt(tekst):
    """Treść do <script>/<style> w HTML – nie może zawierać zamykającego znacznika."""
    return re.sub(r"</(script|style)", r"<\\/\1", tekst, flags=re.I)


def blok_html():
    meta = json.loads(czytaj(os.path.join(DANE, "meta.json")))
    png = {}
    for w in meta["warstwy"]:
        sciezka = os.path.join(DANE, w["plik"])
        if os.path.exists(sciezka):
            with open(sciezka, "rb") as f:
                png[w["id"]] = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")
    dane = json.dumps({"meta": meta, "png": png}, ensure_ascii=False, separators=(",", ":"))
    return (f"{POCZATEK}\n"
            f"        <style>\n{czytaj(os.path.join(DODATEK, 'rolnik.css'))}\n        </style>\n"
            f"        <script>window.ROLNIK_DANE = {bezpieczny_skrypt(dane)};</script>\n"
            f"        <script>\n{bezpieczny_skrypt(czytaj(os.path.join(DODATEK, 'rolnik.js')))}\n        </script>\n"
            f"        {KONIEC}"), len(png)


def wstaw_do_index(mapa):
    indeks = os.path.join(mapa, "index.html")
    html = czytaj(indeks)
    blok, ile = blok_html()
    if POCZATEK in html and KONIEC in html:
        a = html.index(POCZATEK)
        b = html.index(KONIEC) + len(KONIEC)
        html = html[:a] + blok + html[b:]
    else:
        # usuń stare dołączenie plików z folderu rolnik/
        html = re.sub(r'[ \t]*<!-- dodatek rolnik -->\r?\n', '', html)
        html = re.sub(r'[ \t]*<link rel="stylesheet" href="\./rolnik/rolnik\.css">\r?\n', '', html)
        html = re.sub(r'[ \t]*<script src="\./rolnik/rolnik\.js"></script>\r?\n', '', html)
        if PO_SKRYPCIE not in html:
            sys.exit(f"W {indeks} nie ma {PO_SKRYPCIE} – nie wiem, gdzie wstawić dodatek.")
        html = html.replace(PO_SKRYPCIE, PO_SKRYPCIE + "\n        " + blok, 1)
    with open(indeks, "w", encoding="utf-8", newline="") as f:
        f.write(html)
    print(f"\nWstawiono dodatek i {ile} warstw do {indeks} ({os.path.getsize(indeks) / 1e6:.1f} MB)")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--gleba", action="store_true", help="przelicz także glebę")
    p.add_argument("--tylko-wstaw", action="store_true", help="nie pobieraj, tylko wstaw _dane do index.html")
    p.add_argument("--mapa", default=MAPA, help="folder eksportu qgis2web")
    a = p.parse_args()

    if not a.tylko_wstaw:
        if a.gleba or not os.path.exists(os.path.join(DANE, "meta_gleba.json")):
            uruchom("gleba_mapa.py", "--wyjscie", DANE)
        uruchom("era5_mapa.py", "--wyjscie", DANE)
        uruchom("landsat_mapa.py", "--wyjscie", DANE, "--chmury", "10", "--dni", "90")
    uruchom("siatka.py", "--polacz", DANE)
    wstaw_do_index(a.mapa)


if __name__ == "__main__":
    main()
