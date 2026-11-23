# Pallet Track: demo

This demo tracks pallets with QR codes. Floor staff scan each pallet with a phone when it goes out (**LOAD OUT**) and when it comes back (**UNLOAD IN**). The app is plain HTML, CSS and JS, with no build step. All data stays in the phone's browser (`localStorage`).

## Files
| File | What it is |
|---|---|
| `index.html` | The app. It has 6 pages: Scan, Dashboard, Inventory, History, QR Codes, Settings |
| `app.js` | All the app logic |
| `style.css` | Styles, including the print layout for labels |
| `vendor/` | QR libraries, copied in so no CDN is needed: `html5-qrcode` 2.3.8 for scanning and `qrcode-generator` 1.4.4 for making codes |
| `manifest.webmanifest`, `icon*` | Let you "Add to Home Screen" so the app opens like a normal app |

## Run on a laptop
The camera only works on `https://` or `localhost`. On a laptop, run:

```
python -m http.server 8080
```

Then open http://localhost:8080.

## Put it on a phone (needs HTTPS)
On a phone, `http://192.168.x.x` will **not** open the camera. Host the folder on a free HTTPS static host.

**Netlify Drop (easiest, no git):**
1. Go to https://app.netlify.com/drop and sign in.
2. Drag this whole folder onto the page.
3. Open the `https://….netlify.app` link on the phone.

**GitHub Pages:**
1. Push this folder to a GitHub repo.
2. In the repo, open Settings → Pages and set Source to "Deploy from a branch", branch `main`, folder `/root`.
3. Open `https://<user>.github.io/<repo>/` on the phone.

**Vercel:** run `npx vercel` in this folder, or import the repo on vercel.com.

On the phone, tap **Allow** when the browser asks for the camera. You can then use Share → **Add to Home Screen** so the app opens full-screen.

## Phone and computer layout
- **Phone:** a bottom tab bar, with big buttons for one-handed scanning. The app opens on **Scan**.
- **Computer (screen 960 px or wider):** a left sidebar, and the owner pages (Dashboard, Inventory, History, QR Codes, Settings) use the full width with more compact controls. The app opens on **Dashboard**. The Scan page stays a narrow phone-style column, because scanning is meant to be done on a phone.

## Inventory page
For the owner: how many pallets each customer has, and where they are now.
- **Pallets by customer:** pallets assigned, at the warehouse, out with FG and damaged for each customer, plus a bar showing the split, the longest time any of them has been out (days) and the last activity. A total row is at the bottom. Customers in Settings with no pallets show as 0. **Export CSV** saves this table.
- **Out with FG: by destination:** where the pallets that are out went on their last Load Out, how many, and for how long.
- **At warehouse: by location:** where the returned pallets were last scanned.
- Tapping any row opens the Dashboard already filtered: by that customer, or by the OUT / AT WAREHOUSE status plus that destination or location.

The Dashboard also has a **search box** that searches pallet ID, customer, destination and location.

The Inventory page, like the rest of the app, counts only the scans saved on the device you are using.

## Demo script (like the real thing)
1. **Print labels.** On a laptop, open the hosted link and go to **QR Codes**. Pick a customer in **Show labels for**, or leave it on All customers, and tap **Print pallet labels**. The A4 sheet has 6 big labels per page, and each label shows the QR, the pallet ID and the customer name. Also tap **Print location cards**. Stick each label on a pallet, or on a box if you have no pallets.
2. **Phone.** Open the same link on the phone. On first open it loads the sample data, which has **the same 30 pallet IDs** as the printed labels (see "Fixed demo IDs" below). Every printed label is therefore known to the phone, and each one already has a history.
3. **Set your name.** Tap the name at the top right, or go to Settings.
4. **Scan tab:**
   - Scan a location card. It beeps and sets the location.
   - Tap **LOAD OUT** and then **Start camera**.
   - Walk along the pallets. Each label beeps and vibrates and is added to the list with no tapping between pallets.
   - If a label is already OUT you hear a double beep and see a yellow warning. The pallet is still added, because warnings never block.
   - You can set a pallet to **Damaged** in the list, or remove it with **×**.
   - Optional: open **More details** to add a vehicle number, destination, challan number, remarks or a photo.
   - Tap **CONFIRM**. A green success message shows the count.
5. **Dashboard:**
   - The tiles change as you scan.
   - The table is sorted by "days since last scan", highest first, so the 6 pallets that have been out 30–50 days are at the top.
   - Tap a row to see that pallet's history.
   - Tap **Export CSV**. On a phone this opens the share sheet (WhatsApp, email, Files).
6. **Unload.** Tap **UNLOAD IN** and scan the same pallets. Their status changes back to AT WAREHOUSE.
7. **Manual entry.** Type an ID with one letter changed. The app rejects it with "This pallet is not in the system."

Tips for scanning:
- Hold the phone 20–60 cm from the label.
- Use the **🔦 Light** button in dim places. It shows only on Android, because iPhone Safari does not allow it.
- Use **Zoom** for labels that are far away, if the phone supports it.
- On iPhone, beeps are silent when the ring/silent switch is set to silent. Vibration does not work in iPhone Safari, so the screen flash and banner are the feedback.

## Customer name on labels
Each pallet can be marked as rented to a customer, for example `ABC Auto Components`.
- Manage the list in **Settings → Customers who rent pallets**, or use **+ Add new customer…** in the QR Codes tab.
- In **QR Codes**, choose **Rented to** and tap **Generate pallets**. Every new label prints that customer's name under the QR, and the sheet switches to show just that batch, ready to print.
- **The QR holds only the pallet ID.** The customer name is printed text, stored on the pallet record (`pallet.customer`). The QR itself never needs to change.
- The customer name appears in the Dashboard (column and filter, and the tiles follow the filter), in History, in the scan list and in the CSV export.
- The sample data rents its 30 pallets to 3 made-up customers, 10 each.

## Fixed demo IDs
Pallet IDs look random, for example `PLT-7K3M9QX`. Each is 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` plus a check character. For the demo they come from a **fixed seed**, so every device makes the same IDs. Because data is not shared between phones, this is what lets labels printed on one device be recognised on every phone.
- "Generate pallets" adds the next IDs from the same sequence. If you print new labels this way, generate the same number for the same customer on the phone as well.
- **Reset all** followed by **Load sample data** brings back the same 30 IDs, so your printed labels keep working.
- For real use, set `DEMO_FIXED_IDS = false` at the top of `app.js` to get truly random IDs.

**Check character:** a weighted mod-31 checksum, where the sum of position × value over the 7 characters must be 0 mod 31. Because 31 is prime, it catches **every** single wrong character and **every** swap of two characters. (Luhn mod N was not used because its doubling step misses some typos when the alphabet size is odd.)

## Data
A pallet record is `{ id, createdAt, customer }`. Data is stored in `localStorage` under these keys: `pt_pallets`, `pt_scans`, `pt_settings`, `pt_photos` and `pt_session` (the list scanned but not yet confirmed).
- Scans are append-only. There is no edit or delete. To fix a mistake, scan again.
- A photo is compressed to 300 px wide and stored **once per confirmed batch** in `pt_photos`. Each scan's `photo` field holds a reference (`ph_…`) to it. This avoids copying one photo onto 20 scans and filling up storage.
- Each phone and each browser has its own data. Two phones do not share data, and clearing browser data deletes everything.

## Not in this demo
Overdue or lost rules, trip or batch view, login, a shared database, offline sync, billing or ERP integration, RFID.
