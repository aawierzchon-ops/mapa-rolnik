#!/usr/bin/env python3
"""
Składa stronę do publikacji:
  mapa/          (eksport z qgis2web: OpenLayers lub Leaflet)  ->  _site/
  rolnik/        (dodatek JS/CSS)               ->  _site/rolnik/
  _dane/         (warstwy z skryptów)           ->  _site/rolnik/dane/
i dopisuje do _site/index.html dwie linijki ładujące dodatek.

Przykład:  python skrypty/zbuduj_strone.py --mapa mapa --dane _dane --wyjscie _site
"""
import argparse
import os
import shutil
import sys

ZNACZNIK = "<!-- dodatek rolnik -->"
WSTAWKA = (f'{ZNACZNIK}\n<link rel="stylesheet" href="rolnik/rolnik.css">\n'
           '<script src="rolnik/rolnik.js"></script>\n')


def znajdz_html(katalog):
    """index.html, a jeśli go nie ma - plik .html z mapą qgis2web (np. gis2.html)."""
    if os.path.isfile(os.path.join(katalog, "index.html")):
        return os.path.join(katalog, "index.html")
    pliki = sorted(f for f in os.listdir(katalog) if f.lower().endswith((".html", ".htm")))
    if not pliki:
        sys.exit(f"W folderze '{katalog}' nie ma pliku .html - wgraj tam zawartość eksportu z qgis2web.")
    for f in pliki:
        with open(os.path.join(katalog, f), encoding="utf-8", errors="replace") as h:
            tekst = h.read().lower()
        if "qgis2web.js" in tekst or "leaflet" in tekst:
            return os.path.join(katalog, f)
    return os.path.join(katalog, pliki[0])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mapa", default="mapa")
    p.add_argument("--dodatek", default="rolnik")
    p.add_argument("--dane", default="_dane")
    p.add_argument("--wyjscie", default="_site")
    a = p.parse_args()

    indeks = znajdz_html(a.mapa)
    print(f"Strona główna eksportu: {os.path.basename(indeks)}")
    with open(indeks, encoding="utf-8") as f:
        html = f.read()
    niski = html.lower()
    if "qgis2web.js" in niski or "ol.js" in niski:
        print("Wykryto eksport OpenLayers.")
    elif "leaflet" in niski:
        print("Wykryto eksport Leaflet.")
    else:
        sys.exit(f"{indeks} nie wygląda na eksport z qgis2web (brak OpenLayers i Leaflet).")

    if os.path.exists(a.wyjscie):
        shutil.rmtree(a.wyjscie)
    shutil.copytree(a.mapa, a.wyjscie)
    shutil.copytree(a.dodatek, os.path.join(a.wyjscie, "rolnik"))
    shutil.copytree(a.dane, os.path.join(a.wyjscie, "rolnik", "dane"),
                    ignore=shutil.ignore_patterns("meta_*.json"))

    if ZNACZNIK not in html:
        poz = html.lower().rfind("</body>")
        html = html[:poz] + WSTAWKA + html[poz:] if poz >= 0 else html + WSTAWKA
    nazwy = {"index.html", os.path.basename(indeks)}   # np. gis2.html też dostaje dodatek
    for nazwa in nazwy:
        with open(os.path.join(a.wyjscie, nazwa), "w", encoding="utf-8") as f:
            f.write(html)
    open(os.path.join(a.wyjscie, ".nojekyll"), "w").close()
    print(f"Strona gotowa w {a.wyjscie}/")


if __name__ == "__main__":
    main()
