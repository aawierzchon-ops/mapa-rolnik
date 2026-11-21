# Mapa dla rolnika – cała Polska

Mapa z qgis2web (OpenLayers albo Leaflet) + automatycznie odświeżane warstwy analityczne.

| Folder | Co zawiera |
|---|---|
| `mapa/` | **tu wklej zawartość eksportu z qgis2web** (index.html, resources/, layers/, styles/, …) |
| `rolnik/` | dodatek do mapy: panel warstw, legenda, okienko po kliknięciu |
| `skrypty/` | pobieranie i liczenie danych (Landsat, ERA5-Land, gleba) |
| `.github/workflows/mapa.yml` | codzienne uruchamianie i publikacja na GitHub Pages |

## Warstwy (siatka ok. 500 m, EPSG:3857)

| Źródło | Warstwy | Odświeżanie |
|---|---|---|
| Landsat 8/9 C2 L2 (USGS, przez Planetary Computer) | NDVI, NDWI, NDDI, temperatura powierzchni | codziennie, najnowszy bezchmurny piksel z 90 dni, sceny < 10% chmur |
| ERA5-Land (Copernicus, przez Open-Meteo) | temperatura i wilgotność gleby 0–7 cm, opady 7 dni | codziennie (dane z ok. 5-dniowym opóźnieniem) |
| SoilGrids 2.0 (ISRIC) | typ gleby (USDA), porowatość | raz |
| Open-Meteo (w przeglądarce) | temperatura powierzchni teraz, prognoza 7 dni, gotowość do siewu | przy każdym kliknięciu |

## Test u siebie (opcjonalnie)

```
pip install -r requirements.txt
python skrypty/gleba_mapa.py --wyjscie _dane
python skrypty/landsat_mapa.py --wyjscie _dane
python skrypty/era5_mapa.py --wyjscie _dane
python skrypty/siatka.py --polacz _dane
python skrypty/zbuduj_strone.py --mapa mapa --dane _dane --wyjscie _site
cd _site && python -m http.server 8000
```
Potem otwórz http://localhost:8000 (nie przez dwuklik – przeglądarka blokuje wtedy wczytywanie danych).

Dane: Landsat – USGS; ERA5-Land – Copernicus Climate Change Service / ECMWF; Open-Meteo (CC BY 4.0, użycie niekomercyjne);
SoilGrids – ISRIC (CC BY 4.0).
