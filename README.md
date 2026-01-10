# DODO Delivery (Tesco HU) – Home Assistant (beta)

Ez az egyéni (custom) integráció a DODO nyomkövetés publikus endpointját használva lekéri a Tesco (HU) kiszállítás állapotát **egyetlen szenzorban**, attribútumokkal.

## Mit tud?
- 1 db szenzor entitás (attribútumokban: státusz, idősáv, expectedStart, futár, pickup koordináta, stb.)
- Poll alapú frissítés
- Tracking code megadható:
  - kézzel (manual)
  - vagy **entity-ből** (pl. `input_text.dodo_tracking_code`) – ez a javasolt

## Adatvédelmi megjegyzés
A DODO API válaszában szerepelhetnek helyadatok (koordináták). Aki telepíti, tudomásul veszi, hogy a szenzor attribútumaiban ezek megjelenhetnek.

---

# Telepítés (béta)

## 1) Integráció fájlok bemásolása
Másold a repo `custom_components/dodo_delivery/` mappáját ide:

`/config/custom_components/dodo_delivery/`

Indítsd újra a Home Assistant-et.

## 2) Integráció hozzáadása
Beállítások → Eszközök és szolgáltatások → Integráció hozzáadása → **DODO Delivery**

A varázslóban választhatsz:
- **Entity mód** (ajánlott): add meg a tracking code-ot tartalmazó entitást (pl. `input_text.dodo_tracking_code`)
- **Manual mód**: add meg kézzel a 8 karakteres tracking code-ot

---

# IMAP automatizálás (opcionális)

A Tesco/DODO küld egy e-mailt, benne `https://t.idodo.group/XXXXXXXX` linkkel (8 karakter a kód).
Az alábbi blueprint ezt kiolvassa és beírja az `input_text` entitásba.

## 1) IMAP integration beállítása
Beállítások → Integrációk → IMAP

- Search: `UnSeen UnDeleted` (alap)
- Folder: `INBOX` (vagy ahova jön)
- Jelöld be: Subject + Text/Body (hogy az esemény payloadban benne legyen)

## 2) Input Text létrehozása
Beállítások → Eszközök és szolgáltatások → Segédek → **Szöveg**
Pl.: `input_text.dodo_tracking_code`

## 3) Blueprint import + automation létrehozás
- Automation → Blueprints → Import blueprint (URL vagy fájl)
- Blueprint import URL: https://raw.githubusercontent.com/tomorigabor/ha-dodo-delivery/main/blueprints/automation/dodo_delivery_imap_to_input_text.yaml
- Hozz létre belőle egy automatizmust:
  - add meg az IMAP entry_id-t (IMAP integrációból)
  - add meg a cél `input_text` entitást

---

# Teszt
- Küldj magadnak egy teszt e-mailt, lehetőleg forwardolva magadnak egy korábbi DODO-s e-mailt amit kapsz mikor elindul a folyamat
- Nézd meg, hogy az input_text frissül-e, majd az integráció szenzora aktiválódik-e.
