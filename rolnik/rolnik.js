/*
 * Dodatek „Rolnik” do mapy wyeksportowanej z qgis2web (OpenLayers lub Leaflet).
 *  - panel z warstwami analitycznymi (Landsat 8/9, ERA5-Land, gleba) + legenda,
 *  - kliknięcie w dowolny punkt: wartości z warstw + dane na żywo z Open-Meteo
 *    (ERA5-Land i prognoza) z oceną gotowości do siewu dla kilku upraw.
 * Warstwy to 8-bitowe PNG w EPSG:3857 opisane w dane/meta.json (tworzą je skrypty w skrypty/).
 */
(function () {
  'use strict';

  var BAZA = (document.currentScript && document.currentScript.src)
    ? document.currentScript.src.replace(/[^/]*$/, '') : 'rolnik/';
  var DANE = BAZA + 'dane/';
  var STREFA = 'Europe/Warsaw';
  var R = 6378137;

  // Minimalna temperatura gleby do siewu [°C] - wartości orientacyjne, do weryfikacji agronomicznej
  var UPRAWY = [['kukurydza', 10], ['soja', 10], ['słonecznik', 8], ['ziemniak', 8],
    ['burak cukrowy', 6], ['groch', 5], ['pszenica jara', 5], ['jęczmień jary', 5], ['owies', 5]];
  var PROG_ZA_MOKRO = 0.40;   // m³/m³
  var DNI_STABILNIE = 3;

  var PALETY = {
    ndvi: ['#8c510a', '#d8b365', '#f6e8c3', '#c7e9a0', '#7fc97f', '#1a9641', '#00441b'],
    ndwi: ['#8c510a', '#dfc27d', '#f6f6f6', '#9ecae1', '#3182bd', '#08306b'],
    nddi: ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c', '#67000d'],
    temperatura: ['#313695', '#4575b4', '#74add1', '#e0f3f8', '#ffffbf', '#fee090', '#f46d43', '#a50026'],
    wilgotnosc: ['#8c510a', '#dfc27d', '#c7eae5', '#5ab4ac', '#01665e', '#003c30'],
    opady: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'],
    porowatosc: ['#fde725', '#7ad151', '#22a884', '#2a788e', '#414487', '#440154'],
    szara: ['#000000', '#ffffff'],
    kategorie_gleba: ['#fff7bc', '#fee391', '#fec44f', '#c2a45a', '#d9c7a0', '#e8dccb',
      '#d6604d', '#b2654a', '#a6761d', '#e7298a', '#9e6ab8', '#6a3d9a']
  };

  // ================================================================== narzędzia

  function hex(c) { return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)]; }

  function tablicaKolorow(w) {
    var lut = new Uint8ClampedArray(256 * 4), i, k;
    var pal = PALETY[w.paleta] || PALETY.szara;
    if (w.kategorie) {
      for (i = 1; i <= w.kategorie.length && i < 256; i++) {
        k = hex(pal[(i - 1) % pal.length]);
        lut.set([k[0], k[1], k[2], 255], i * 4);
      }
      return lut;
    }
    var stopy = pal.map(hex);
    for (i = 1; i < 256; i++) {
      var t = (i - 1) / 254 * (stopy.length - 1), j = Math.min(Math.floor(t), stopy.length - 2), f = t - j;
      lut.set([0, 1, 2].map(function (c) { return Math.round(stopy[j][c] + f * (stopy[j + 1][c] - stopy[j][c])); })
        .concat([255]), i * 4);
    }
    return lut;
  }

  function format(v, miejsca) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    return Number(v).toFixed(miejsca === undefined ? 2 : miejsca).replace('.', ',');
  }

  function doMerkatora(lon, lat) {
    return [lon * Math.PI / 180 * R, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R];
  }

  // ================================================================== dane rastrowe

  var meta = null, warstwy = {};

  function wczytajWarstwe(w) {
    if (warstwy[w.id]) return warstwy[w.id].obietnica;
    var st = warstwy[w.id] = { meta: w };
    st.obietnica = new Promise(function (ok, blad) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        var px = ctx.getImageData(0, 0, c.width, c.height);
        var q = new Uint8Array(c.width * c.height);
        for (var i = 0, n = q.length; i < n; i++) q[i] = px.data[i * 4];
        st.q = q; st.szer = c.width; st.wys = c.height; st.canvas = c; st.ctx = ctx; st.px = px;
        ok(st);
      };
      img.onerror = function () { blad(new Error('Nie można wczytać ' + w.plik)); };
      img.src = DANE + w.plik + '?v=' + encodeURIComponent(meta.wersja || '');
    });
    return st.obietnica;
  }

  function obrazKolorowy(st) {
    if (st.url) return st.url;
    var lut = tablicaKolorow(st.meta), d = st.px.data, q = st.q;
    for (var i = 0, n = q.length; i < n; i++) {
      var o = q[i] * 4;
      d[i * 4] = lut[o]; d[i * 4 + 1] = lut[o + 1]; d[i * 4 + 2] = lut[o + 2]; d[i * 4 + 3] = lut[o + 3];
    }
    st.ctx.putImageData(st.px, 0, 0);
    st.url = st.canvas.toDataURL('image/png');
    st.px = null;
    return st.url;
  }

  function wartoscW(st, x, y) {      // x, y w EPSG:3857
    var s = meta.siatka;
    var kol = Math.floor((x - s.xmin) / s.piksel_m), wiersz = Math.floor((s.ymax - y) / s.piksel_m);
    if (kol < 0 || wiersz < 0 || kol >= st.szer || wiersz >= st.wys) return null;
    var q = st.q[wiersz * st.szer + kol];
    if (q === 0) return null;
    var w = st.meta;
    if (w.kategorie) return { tekst: w.kategorie[q - 1], kod: q };
    return { liczba: w.min + (q - 1) / 254 * (w.max - w.min) };
  }

  // ================================================================== adaptery map

  // OpenLayers (qgis2web: resources/qgis2web.js tworzy globalną zmienną `map`)
  function adapterOL(map) {
    var warstwaObrazu = null, nakladkaPopup = null, elPopup = null, elTresc = null;
    var s = meta.siatka;
    var zasieg = [s.xmin, s.ymin, s.xmax, s.ymax];
    function rzutMapy() { return map.getView().getProjection(); }
    return {
      nazwa: 'openlayers',
      dodajPanel: function (div) {
        div.classList.add('ol-unselectable', 'rolnik-ol');
        map.addControl(new ol.control.Control({ element: div }));
      },
      pokazObraz: function (url, przezr) {
        var zrodlo = new ol.source.ImageStatic({ url: url, imageExtent: zasieg, projection: 'EPSG:3857', interpolate: false });
        if (!warstwaObrazu) {
          // własność 'title' nieustawiona -> warstwa nie pojawia się w przełączniku warstw qgis2web
          warstwaObrazu = new ol.layer.Image({ source: zrodlo, opacity: przezr, zIndex: 50 });
          warstwaObrazu.set('interactive', false);
          map.addLayer(warstwaObrazu);
        } else {
          warstwaObrazu.setSource(zrodlo);
          warstwaObrazu.setOpacity(przezr);
          warstwaObrazu.setVisible(true);
        }
      },
      ukryjObraz: function () { if (warstwaObrazu) warstwaObrazu.setVisible(false); },
      ustawPrzezroczystosc: function (p) { if (warstwaObrazu) warstwaObrazu.setOpacity(p); },
      naKlikniecie: function (fn) {
        map.on('singleclick', function (evt) {
          // nie przeszkadzamy narzędziu pomiaru qgis2web
          try { if (typeof measuring !== 'undefined' && measuring) return; } catch (e) { /* brak */ }
          try { if (typeof sketch !== 'undefined' && sketch) return; } catch (e) { /* brak */ }
          var proj = rzutMapy();
          var ll = ol.proj.toLonLat(evt.coordinate, proj);
          var m = ol.proj.transform(evt.coordinate, proj, 'EPSG:3857');
          // czy pod kursorem jest obiekt z warstwy mapy (wtedy swoje okienko otworzy też qgis2web)
          var obiekt = false;
          try {
            obiekt = map.hasFeatureAtPixel(evt.pixel, {
              layerFilter: function (l) { return l.get('interactive') !== false; }
            });
          } catch (e) { /* brak */ }
          fn({ lat: ll[1], lng: ll[0], x: m[0], y: m[1], kotwica: evt.coordinate, obiekt: obiekt });
        });
      },
      otworzPopup: function (pkt, html) {
        if (!nakladkaPopup) {
          elPopup = document.createElement('div');
          elPopup.className = 'rolnik-ol-popup';
          elPopup.innerHTML = '<a href="#" class="rolnik-ol-zamknij" title="Zamknij">×</a><div class="rolnik-ol-tresc"></div>';
          elTresc = elPopup.querySelector('.rolnik-ol-tresc');
          nakladkaPopup = new ol.Overlay({ element: elPopup, positioning: 'bottom-center', offset: [0, -14],
            stopEvent: true, autoPan: { animation: { duration: 250 }, margin: 40 } });
          map.addOverlay(nakladkaPopup);
          elPopup.querySelector('.rolnik-ol-zamknij').onclick = function (e) {
            e.preventDefault(); nakladkaPopup.setPosition(undefined);
          };
        }
        // nad obiektem z mapy okienko qgis2web pokazuje się NAD punktem - nasze dajemy wtedy POD punktem
        var pod = !!pkt.obiekt;
        elPopup.classList.toggle('pod', pod);
        nakladkaPopup.setPositioning(pod ? 'top-center' : 'bottom-center');
        nakladkaPopup.setOffset(pod ? [0, 14] : [0, -14]);
        elTresc.innerHTML = html;
        nakladkaPopup.setPosition(pkt.kotwica);
        return {
          ustaw: function (h) {
            elTresc.innerHTML = h;
            nakladkaPopup.setPosition(undefined); nakladkaPopup.setPosition(pkt.kotwica); // ponowne dopasowanie widoku
          }
        };
      }
    };
  }

  // Leaflet (qgis2web: `var map = L.map(...)` w index.html)
  function adapterLeaflet(map) {
    var nakladka = null;
    var PUSTY = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    return {
      nazwa: 'leaflet',
      dodajPanel: function (div) {
        div.classList.add('leaflet-bar', 'rolnik-leaflet');
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        var Panel = L.Control.extend({ options: { position: 'topright' }, onAdd: function () { return div; } });
        new Panel().addTo(map);
      },
      pokazObraz: function (url, przezr) {
        if (!nakladka) nakladka = L.imageOverlay(PUSTY, meta.siatka.granice_wgs, { opacity: przezr, className: 'rolnik-warstwa' });
        nakladka.setUrl(url).setOpacity(przezr);
        if (!map.hasLayer(nakladka)) nakladka.addTo(map);
      },
      ukryjObraz: function () { if (nakladka) map.removeLayer(nakladka); },
      ustawPrzezroczystosc: function (p) { if (nakladka) nakladka.setOpacity(p); },
      naKlikniecie: function (fn) {
        map.on('click', function (e) {
          var p = L.CRS.EPSG3857.project(e.latlng);
          fn({ lat: e.latlng.lat, lng: e.latlng.lng, x: p.x, y: p.y, kotwica: e.latlng });
        });
      },
      otworzPopup: function (pkt, html) {
        var popup = L.popup({ maxWidth: 360, className: 'rolnik-popup', autoPanPaddingTopLeft: [10, 60] })
          .setLatLng(pkt.kotwica).setContent(html).openOn(map);
        return { ustaw: function (h) { popup.setContent(h); } };
      }
    };
  }

  // ================================================================== panel

  function zbudujPanel(A) {
    var div = document.createElement('div');
    div.className = 'rolnik-panel';
    var html = '<div class="rolnik-naglowek"><span>Analiza dla rolnika</span>' +
      '<button type="button" class="rolnik-zwin" title="Zwiń / rozwiń">–</button></div>' +
      '<div class="rolnik-tresc"><label class="rolnik-opcja"><input type="radio" name="rolnik-w" value="" checked> brak warstwy</label>';
    var grupy = {};
    meta.warstwy.forEach(function (w) {
      if (!w.ukryta) (grupy[w.grupa] = grupy[w.grupa] || []).push(w);
    });
    var kolejnosc = ['Landsat 8/9', 'ERA5-Land', 'Gleba'];
    var poz = function (g) { var i = kolejnosc.indexOf(g); return i < 0 ? 99 : i; };
    Object.keys(grupy).sort(function (a, b) { return poz(a) - poz(b); }).forEach(function (g) {
      html += '<div class="rolnik-grupa">' + g + '</div>';
      grupy[g].forEach(function (w) {
        html += '<label class="rolnik-opcja"><input type="radio" name="rolnik-w" value="' + w.id + '"' +
          (w.pokrycie === 0 ? ' disabled' : '') + '> ' + w.nazwa + (w.pokrycie === 0 ? ' <i>(brak danych)</i>' : '') + '</label>';
      });
    });
    html += '<div class="rolnik-przezr">Przezroczystość <input type="range" min="0.2" max="1" step="0.05" value="0.75"></div>' +
      '<div class="rolnik-legenda"></div>' +
      '<div class="rolnik-stopka">Kliknij w dowolne miejsce mapy, aby zobaczyć dane dla punktu.<br>' +
      'Dane: Landsat – USGS · ERA5-Land – Copernicus/ECMWF przez <a href="https://open-meteo.com" target="_blank">Open-Meteo</a> · ' +
      'gleba – SoilGrids/ISRIC</div></div>';
    div.innerHTML = html;
    if (window.innerWidth < 700) div.classList.add('zwiniety');
    div.querySelector('.rolnik-zwin').onclick = function () { div.classList.toggle('zwiniety'); };
    var suwak = div.querySelector('.rolnik-przezr input');
    div.querySelectorAll('input[name=rolnik-w]').forEach(function (r) {
      r.onchange = function () { pokazWarstwe(A, r.value, div, +suwak.value); };
    });
    suwak.oninput = function () { A.ustawPrzezroczystosc(+suwak.value); };
    A.dodajPanel(div);
  }

  var aktywna = '';
  function pokazWarstwe(A, id, div, przezr) {
    aktywna = id;
    var leg = div.querySelector('.rolnik-legenda');
    if (!id) { A.ukryjObraz(); leg.innerHTML = ''; return; }
    var w = meta.warstwy.filter(function (x) { return x.id === id; })[0];
    leg.innerHTML = '<i>Wczytywanie…</i>';
    wczytajWarstwe(w).then(function (st) {
      if (aktywna !== id) return;          // użytkownik zdążył wybrać inną warstwę
      A.pokazObraz(obrazKolorowy(st), przezr);
      leg.innerHTML = legenda(w);
    }).catch(function (e) { leg.innerHTML = '<span class="rolnik-blad">' + e.message + '</span>'; });
  }

  function legenda(w) {
    var pal = PALETY[w.paleta] || PALETY.szara;
    var h = '<div class="rolnik-leg-tytul">' + w.nazwa + (w.jednostka ? ' [' + w.jednostka + ']' : '') + '</div>';
    if (w.kategorie) {
      h += w.kategorie.map(function (k, i) {
        return '<div class="rolnik-kat"><span style="background:' + pal[i % pal.length] + '"></span>' + k + '</div>';
      }).join('');
    } else {
      h += '<div class="rolnik-pasek" style="background:linear-gradient(to right,' + pal.join(',') + ')"></div>' +
        '<div class="rolnik-skala"><span>' + format(w.min, w.miejsca) + '</span><span>' +
        format((w.min + w.max) / 2, w.miejsca) + '</span><span>' + format(w.max, w.miejsca) + '</span></div>';
    }
    if (w.opis) h += '<div class="rolnik-opis">' + w.opis + '</div>';
    if (w.data) h += '<div class="rolnik-data">' + w.data + '</div>';
    return h;
  }

  // ================================================================== dane na żywo i ocena siewu

  function dataLokalna(d) {
    var p = new Intl.DateTimeFormat('sv-SE', { timeZone: STREFA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
    return { dzien: p.year + '-' + p.month + '-' + p.day, godzina: p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':00' };
  }

  function przesunDni(dzien, n) {
    var d = new Date(dzien + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function srednieDobowe(h, zmienna, minGodzin) {
    var dni = {}, wynik = [];
    (h.time || []).forEach(function (t, i) {
      var v = (h[zmienna] || [])[i];
      if (v !== null && v !== undefined) (dni[t.slice(0, 10)] = dni[t.slice(0, 10)] || []).push(v);
    });
    Object.keys(dni).sort().forEach(function (d) {
      if (dni[d].length >= (minGodzin || 1)) wynik.push([d, dni[d].reduce(function (a, b) { return a + b; }, 0) / dni[d].length]);
    });
    return wynik;
  }

  function pobierz(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('Open-Meteo ' + r.status + ': ' + t.slice(0, 120)); });
      return r.json();
    });
  }

  function daneNaZywo(pkt) {
    var teraz = dataLokalna(new Date());
    var lat = pkt.lat.toFixed(4), lon = pkt.lng.toFixed(4), tz = encodeURIComponent(STREFA);
    var arch = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + lat + '&longitude=' + lon +
      '&start_date=' + przesunDni(teraz.dzien, -14) + '&end_date=' + przesunDni(teraz.dzien, -5) +
      '&hourly=soil_temperature_0_to_7cm,soil_moisture_0_to_7cm&models=era5_land&timezone=' + tz;
    var prog = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&hourly=soil_temperature_0cm,soil_temperature_6cm,soil_moisture_3_to_9cm' +
      '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=' + tz;
    return Promise.all([pobierz(arch).catch(function (e) { return { blad: e.message }; }), pobierz(prog)])
      .then(function (r) { return ocena(r[0], r[1], teraz); });
  }

  function ocena(era5, prognoza, teraz) {
    var hist = era5.hourly ? srednieDobowe(era5.hourly, 'soil_temperature_0_to_7cm', 20) : [];
    var ost = hist.slice(-3);
    var tEra5 = ost.length ? ost.reduce(function (a, x) { return a + x[1]; }, 0) / ost.length : null;
    var wHist = era5.hourly ? srednieDobowe(era5.hourly, 'soil_moisture_0_to_7cm', 20) : [];
    var h = prognoza.hourly;
    var tPrognoza = srednieDobowe(h, 'soil_temperature_6cm');
    var wPrognoza = srednieDobowe(h, 'soil_moisture_3_to_9cm');
    var iTeraz = h.time.indexOf(teraz.godzina);
    var wilg = wPrognoza.length ? wPrognoza[0][1] : (wHist.length ? wHist[wHist.length - 1][1] : null);

    var uprawy = UPRAWY.map(function (u) {
      var progT = u[1], siewOd = null, i, j, ok;
      for (i = 0; i + DNI_STABILNIE <= tPrognoza.length; i++) {
        ok = true;
        for (j = i; j < i + DNI_STABILNIE; j++) if (tPrognoza[j][1] < progT) ok = false;
        if (ok) { siewOd = tPrognoza[i][0]; break; }
      }
      var pierwsze = tPrognoza.slice(0, 3);
      var cieplo = pierwsze.length === 3 && pierwsze.every(function (x) { return x[1] >= progT; });
      var status = (wilg !== null && wilg > PROG_ZA_MOKRO) ? 'za_mokro'
        : (tEra5 !== null && tEra5 >= progT && cieplo) ? 'gotowe' : siewOd ? 'wkrotce' : 'czekaj';
      return { nazwa: u[0], prog: progT, status: status, siewOd: siewOd };
    });
    return {
      tEra5: tEra5, era5Do: ost.length ? ost[ost.length - 1][0] : null, era5Blad: era5.blad,
      tPow: iTeraz >= 0 ? h.soil_temperature_0cm[iTeraz] : null, wilg: wilg, uprawy: uprawy,
      dni: tPrognoza.map(function (x, i) {
        return { dzien: x[0], tGleby: x[1], opad: prognoza.daily.precipitation_sum[i],
          tMax: prognoza.daily.temperature_2m_max[i], tMin: prognoza.daily.temperature_2m_min[i] };
      })
    };
  }

  var STATUSY = { gotowe: ['można siać', '#1a9641'], wkrotce: ['wkrótce', '#e6a700'],
    czekaj: ['za zimno', '#888'], za_mokro: ['za mokro', '#2171b5'] };

  function dzienKrotko(d) {
    return new Date(d + 'T12:00:00Z').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  }

  function htmlNaZywo(o) {
    var h = '<div class="rolnik-sekcja">Na żywo (Open-Meteo)</div><table class="rolnik-tab">' +
      '<tr><td>Temperatura powierzchni teraz</td><td><b>' + format(o.tPow, 1) + ' °C</b></td></tr>' +
      '<tr><td>Temp. gleby 0–7 cm (ERA5-Land, 3 dni do ' + (o.era5Do || '–') + ')</td><td>' + format(o.tEra5, 1) + ' °C</td></tr>' +
      '<tr><td>Wilgotność gleby (dziś)</td><td>' + format(o.wilg, 2) + ' m³/m³</td></tr></table>';
    if (o.era5Blad) h += '<div class="rolnik-blad">ERA5-Land niedostępne: ' + o.era5Blad + '</div>';
    h += '<div class="rolnik-sekcja">Prognoza 7 dni</div><table class="rolnik-tab rolnik-prognoza">' +
      '<tr><th></th><th>gleba 6 cm</th><th>powietrze</th><th>opad</th></tr>' +
      o.dni.map(function (d) {
        return '<tr><td>' + dzienKrotko(d.dzien) + '</td><td>' + format(d.tGleby, 1) + '°</td><td>' + format(d.tMin, 0) + '…' +
          format(d.tMax, 0) + '°</td><td>' + format(d.opad, 1) + ' mm</td></tr>';
      }).join('') + '</table>';
    h += '<div class="rolnik-sekcja">Gotowość do siewu</div><table class="rolnik-tab">' +
      o.uprawy.map(function (u) {
        var s = STATUSY[u.status];
        return '<tr><td>' + u.nazwa + ' <small>(≥' + u.prog + '°C)</small></td><td><span class="rolnik-status" style="background:' +
          s[1] + '">' + s[0] + '</span>' + (u.status === 'wkrotce' ? ' <small>od ' + dzienKrotko(u.siewOd) + '</small>' : '') + '</td></tr>';
      }).join('') + '</table><div class="rolnik-opis">Progi temperatury są orientacyjne. „Można siać” = gleba ciepła ' +
      'w ERA5-Land i przez 3 najbliższe dni prognozy.</div>';
    return h;
  }

  function htmlZMap(pkt, wart) {
    function wiersz(id, etykieta) {
      var w = wart[id];
      if (!w) return '';
      var m = w.meta, v = w.v;
      var tekst = !v ? '–' : (v.tekst !== undefined ? v.tekst : format(v.liczba, m.miejsca) + (m.jednostka ? ' ' + m.jednostka : ''));
      return '<tr><td>' + (etykieta || m.nazwa) + '</td><td>' + tekst + '</td></tr>';
    }
    var wiek = wart.landsat_wiek && wart.landsat_wiek.v ? Math.round(wart.landsat_wiek.v.liczba) : null;
    var dataZdj = (wiek !== null && meta.zrodla.landsat) ? przesunDni(meta.zrodla.landsat.data_odniesienia, -wiek) : null;
    var h = '<div class="rolnik-wsp">' + pkt.lat.toFixed(4) + '° N, ' + pkt.lng.toFixed(4) + '° E</div>';
    if (meta.zrodla.landsat) {
      h += '<div class="rolnik-sekcja">Satelita Landsat 8/9' + (dataZdj ? ' – zdjęcie z ' + dataZdj : ' – brak bezchmurnego zdjęcia') +
        '</div><table class="rolnik-tab">' + wiersz('ndvi', 'NDVI') + wiersz('ndwi', 'NDWI') + wiersz('nddi', 'NDDI (susza)') +
        wiersz('lst', 'Temp. powierzchni (przelot)') + '</table>';
    }
    if (meta.zrodla.gleba) {
      var p = wart.piasek && wart.piasek.v, i = wart.il && wart.il.v;
      h += '<div class="rolnik-sekcja">Gleba (SoilGrids, 0–30 cm)</div><table class="rolnik-tab">' +
        wiersz('gleba_klasa', 'Typ gleby') + wiersz('porowatosc', 'Porowatość') +
        (p && i ? '<tr><td>Piasek / pył / ił</td><td>' + Math.round(p.liczba) + ' / ' +
          Math.max(0, Math.round(100 - p.liczba - i.liczba)) + ' / ' + Math.round(i.liczba) + ' %</td></tr>' : '') +
        wiersz('gestosc', 'Gęstość objętościowa') + '</table>';
    }
    if (meta.zrodla.era5) {
      h += '<div class="rolnik-sekcja">ERA5-Land (mapa, ' + (meta.zrodla.era5.ostatni_dzien || '') + ')</div><table class="rolnik-tab">' +
        wiersz('opady_7d_era5', 'Opady 7 dni') + '</table>';
    }
    return h;
  }

  function poKliknieciu(A, pkt) {
    var okno = A.otworzPopup(pkt, '<div class="rolnik-okno"><i>Wczytywanie danych…</i></div>');
    var wart = {};
    var czesc1 = '', czesc2 = '<div class="rolnik-sekcja">Na żywo (Open-Meteo)</div><i>Pobieranie prognozy…</i>';
    function odswiez() { okno.ustaw('<div class="rolnik-okno">' + czesc1 + czesc2 + '</div>'); }
    Promise.all(meta.warstwy.filter(function (w) { return w.pokrycie > 0; }).map(function (w) {
      return wczytajWarstwe(w).then(function (st) { wart[w.id] = { meta: w, v: wartoscW(st, pkt.x, pkt.y) }; })
        .catch(function () { wart[w.id] = { meta: w, v: null }; });
    })).then(function () { czesc1 = htmlZMap(pkt, wart); odswiez(); });
    daneNaZywo(pkt).then(function (o) { czesc2 = htmlNaZywo(o); odswiez(); })
      .catch(function (err) { czesc2 = '<div class="rolnik-blad">Nie udało się pobrać danych na żywo: ' + err.message + '</div>'; odswiez(); });
  }

  // ================================================================== start

  function znajdzMape() {
    var kandydat = null;
    try { if (typeof map !== 'undefined') kandydat = map; } catch (e) { /* brak zmiennej */ }
    var jestOL = function (m) { return window.ol && ol.Map && m instanceof ol.Map; };
    var jestL = function (m) { return window.L && L.Map && m instanceof L.Map; };
    if (kandydat && jestOL(kandydat)) return adapterOL(kandydat);
    if (kandydat && jestL(kandydat)) return adapterLeaflet(kandydat);
    for (var k in window) {
      try {
        if (jestOL(window[k])) return adapterOL(window[k]);
        if (jestL(window[k])) return adapterLeaflet(window[k]);
      } catch (e) { /* pomijamy */ }
    }
    return null;
  }

  function start() {
    fetch(DANE + 'meta.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (m) {
      meta = m;
      var A = znajdzMape();
      if (!A) { console.error('Rolnik: nie znaleziono mapy OpenLayers ani Leaflet.'); return; }
      zbudujPanel(A);
      A.naKlikniecie(function (pkt) { poKliknieciu(A, pkt); });
      document.documentElement.setAttribute('data-rolnik', A.nazwa);
    }).catch(function (e) { console.error('Rolnik: brak danych (rolnik/dane/meta.json)', e); });
  }

  (function czekaj(proby) {
    var gotowe = false;
    try { gotowe = typeof map !== 'undefined' && !!map; } catch (e) { /* brak */ }
    if (gotowe || proby > 100) return start();
    setTimeout(function () { czekaj(proby + 1); }, 100);
  })(0);
})();
