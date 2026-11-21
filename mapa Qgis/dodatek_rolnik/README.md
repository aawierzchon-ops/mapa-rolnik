# Dodatek „rolnik” do mapy qgis2web

Dodatek jest wbudowany w `../index.html` (mapa) skryptem `../odswiez_dane_rolnik.py`.

| Co | Do czego |
|---|---|
| `rolnik/rolnik.js`, `rolnik/rolnik.css` | kod panelu warstw i dymka – źródło, które jest kopiowane do index.html |
| `skrypty/` | pobieranie danych: `landsat_mapa.py` (NDVI, NDWI, NDDI, LST), `era5_mapa.py` (gleba 0–7 cm, opady), `gleba_mapa.py` (SoilGrids), `siatka.py` (wspólna siatka, meta.json) |
| `_dane/` | ostatnio pobrane warstwy PNG + opisy – z nich powstaje blok w index.html |
| `requirements.txt` | biblioteki Pythona do skryptów: `pip install -r requirements.txt` |

Odświeżenie danych i wstawienie do mapy (z folderu `mapa Qgis`):

```
python odswiez_dane_rolnik.py              # nowe dane Landsat + ERA5
python odswiez_dane_rolnik.py --gleba      # także przelicz glebę
python odswiez_dane_rolnik.py --tylko-wstaw   # po zmianie rolnik.js/css – bez pobierania
```

Dane: Landsat – USGS; ERA5-Land/ERA5 – Copernicus/ECMWF przez Open-Meteo (CC BY 4.0); SoilGrids – ISRIC (CC BY 4.0).
