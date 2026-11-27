# รายการทดสอบทั้งหมด (สร้างจากโค้ดจริง)

สร้างใหม่ด้วย `python3 scripts/gen-tests-doc.py` หลังรัน `npm run test:e2e`


## หน่วย · test/unit/api.test.js (18)

- health is public; everything else needs auth + ACCESS
- dev auth is refused against the real sheet (production can never run open)
- bootstrap returns every core tab with its real header row
- diagnostics: all 18 tabs / 178 columns verified
- visit.log writes visit + activity + gps by header, and a repeat is a duplicate
- appointment = follow-up task "ติดตาม" (aCRM style); completing it closes the task
- a plain note is an activity "โน้ต" (no visit row); call/navigate taps are logged as activities
- customer.geo updates only gps columns + mapLink, logs before/after, keeps other columns
- customer.update only allows editable columns
- order.save: draft -> edit lines -> confirm; items replaced not duplicated; amounts by qty*price
- settings / labels / import need admin role
- label.rename merges duplicates; label.delete removes; customers keep other labels
- import.commit is idempotent: same file hash blocked, bills/items never duplicated
- data mapping survives re-ordered columns and extra columns in the real sheet
- missing required column is a clear schema error, not a silent misplaced write
- photo.add stores metadata; store photo id is appended to the customer
- unknown op type and oversize batch (>4 ops, Free-plan subrequest cap) are rejected
- all 18 tabs exist in the fixture store with exact headers

## หน่วย · test/unit/domain.test.js (18)

- dates use Bangkok calendar day
- sales = SUM(bill_items.amount); VAT is never added on top
- number parsing handles commas, blanks and text
- customer status: current / lapsed / closed follow settings
- buy cycle = median gap of distinct purchase dates, only with enough history
- overdue / soon / missed-visit suggestions are computed (never stored)
- calendar counts planned appointments and computed due dates on their day
- legacy pairs: only user-confirmed pairs, and never when names conflict
- same product sold as different codes (promo/dozen) is NOT merged
- unregistered codes list keeps billed name/qty/price and explains, never calls them wrong
- smart search: id, name, phone, label, contact, address, product, bill
- regular items come from real history, ignoring free lines; codes stay text
- quality report flags duplicates and orphan references
- order doc hides product codes but shows customer code
- settings merge keeps unknown keys; latest row wins
- period ranges
- activeFlag as found in the REAL sheet: blank = active, FALSE = closed, TRUE = active
- sales by clerk uses bills.openedBy; salesperson is reported separately and both sum to the total

## หน่วย · test/unit/newcustomer.test.js (8)

- customer.create: temp code N-…, row + phone + activity "เพิ่มลูกค้า" + changes, retried op does not duplicate
- customer.create refuses duplicate name or phone unless the salesperson confirms (force)
- two devices creating shops get different temp codes; the code is derived from the op id (retry-safe)
- customer.assignCode rewrites the id in every tab, refuses an existing code, admin only
- order number follows aCRM: NN + ddmmyy(BE); a number taken by another shop is renumbered on the server
- import.commit: customers + orderLinks (เชื่อมบิล) + review rows in aCRM wording
- new customers: "first purchase" and "newly registered" are different groups
- slip: customer code and product codes shown, baht text, pagination at 15 rows

## หน่วย · test/unit/schema.test.js (7)

- 18 tabs / 178 columns exactly as delivered
- header names unique within each tab
- rows are mapped by header name, tolerate short rows, reordered and extra columns
- objectToRow follows the real sheet header order
- checkHeaders reports missing columns and ignores order
- opId-bearing tabs support duplicate-save protection
- SCHEMA equals the header rows captured from the REAL CRM spreadsheet (all 18 tabs, same order)

## หน่วย · test/unit/sheets.test.js (8)

- service-account JWT (RS256) is accepted and the token is cached
- visit.log through SheetsStore writes by header name, numeric lat/lng as numbers, ids as text
- works when the real sheet has re-ordered columns plus an extra helper column
- order.save replaces items with row deletion (descending) and never leaves duplicates
- trailing-empty trimming by Google does not break key lookup or updates
- import.commit via SheetsStore is idempotent per bill number / (bill,line) / file hash
- missing header in the real sheet fails loudly with the tab and column name
- bootstrap path is a raw passthrough of one batchGet call (no JSON parsing in the Worker)

## หน่วย · test/unit/ttx.test.js (8)

- tokenizer: tab fields, quotes spanning lines, CRLF
- cp874 bytes decode to Thai
- kind detection
- parseBills: bills, items, multi-line names, repeated page header and footer
- VAT rules: 0015 line dropped + VAT_OUT; 0014 kept + VAT_IN; sales never include VAT
- payment / clerk split (rules verified on 9,900 real bills)
- analyzeBills: existing numbers are never overwritten; new bills + flags; order link by customer+total+date
- customers report: parse, map, existing never modified, new ones added, temp shop matched

## ข้อมูลจริง · test/real/real.test.js (5) — รันเมื่อกำหนด REAL_DIR เท่านั้น

- REAL sheet copy: row counts equal the delivery numbers; no duplicate keys; sales = SUM(bill_items.amount)
- REAL bills TTX: parses fully, footer total matches, converts to what the CRM already holds
- REAL customers TTX: all customers already in the sheet, nothing is modified
- REAL import round-trip (in memory): drop the newest bills from a copy, import the real TTX, get the same sales back; second run adds nothing
- REAL delivery slip: order 01121169 reproduces the supplied sample form field by field

## E2E มือถือ 390px · test/e2e/run.mjs (60)

- app boots and renders home without console errors
- version identical in app, service worker and server
- service worker registers and caches app shell under the version key
- unauthorised account sees the login wall, not data
- 4 customer cards, one row, numbers = database
- every KPI card opens the matching list with the same count
- labels are 2 columns, counts from customer_labels, tap filters customers
- smart search finds customer by name, id, phone, label, product and bill
- all 21 pages render without error, overflow or console errors (mobile 390px)
- bottom nav has exactly 5 items in order and each opens its page
- back button returns through history and keeps bottom nav
- customer list: search and status chips work
- 4 tabs; 5 quick buttons in one row in the specified order
- overview shows last bill, regular items, pre-visit note, birthday, store photo and GPS status
- history: search by product, open bill, total = sum of lines (no VAT added)
- VAT bill: total equals sum of its own lines and says VAT not re-added
- legacy-code bill: unregistered shown by name only, no guessed code; confirmed pair flagged
- call / navigate buttons link to tel: and Google Maps directions
- visit form saves note + GPS exactly once (visits, activities, gps rows by header)
- new visit appears immediately in the customer timeline and last-visit date
- appointment (same form) creates an aCRM-style follow-up task "ติดตาม"; calendar shows the day count
- calendar: tap a day lists stores below on the same page; month navigation works
- calendar MONTH view = 12 month cards per year (count each), tap month lists stores; DAY view = day grid; choice remembered
- completing the follow-up task closes it and adds an activity
- cycle page: overdue / soon / missed groups equal the computed lists
- store GPS update: writes customers.gpsLat/gpsLng/mapLink + gps row + changes log
- photo is optional: store photo uploads, row saved and file id attached to customer
- edit customer: only changed columns are written; other columns untouched
- order from latest bill: lines prefilled, cart bar shows count/total, no VAT added
- all four product sources are present (latest bill / past bills / regular / all)
- cart survives Back and a full page reload
- cart: edit quantity & price, total = qty × price, remove line
- save as draft -> row in orders/order_items by header, status draft
- draft opens from the list, edit, confirm -> status confirmed, items replaced (no duplicates)
- re-sending the same op id is answered "duplicate" and changes nothing
- reorder from a history bill skips unregistered lines (never guesses a code)
- legacy confirmed pair (8217 -> 8217*) maps only when names agree; conflicting 9833* never maps
- sales report total = SUM(bill_items.amount) for each period; bills count matches
- sales drill-down: by month/clerk/customer/bills all tappable lists
- new-customers page has two separate groups: first purchase vs newly registered, counts equal computed
- map: lists only stores with GPS, distance sort works, navigate links valid
- every list page has a search box (customers, orders, cycle, calendar day, sales views, new, map, labels, codes, history, imports)
- sales numbers are tappable (bill count -> bills, customers -> customers); clerk view lists clerks AND salespeople
- cycle settings persist to systemSettings (new row), keep comm/vatRate; home counts react
- non-admin cannot save settings or import (UI disabled + server forbids)
- labels: rename merges across customers, delete removes
- quality page: counts vs reference, duplicates/orphans listed, CSV export downloads
- unregistered codes: lists bill no, date, customer, clerk, line; export CSV; never says "wrong"
- diagnostics verifies all 18 tabs / 178 columns from the live store
- create a shop in the field: temp code N-…, rows by header, "ไม่มีรหัสบัญชี" badge, activity เพิ่มลูกค้า
- duplicate shop (same name or phone) is blocked until the salesperson confirms; server refuses too
- temp shop is separated: filter chip "ยังไม่มีรหัสบัญชี", listed under "เพิ่มทะเบียน" (not first purchase), order slip says รอรหัสบัญชี
- TTX customers report (real layout, cp874): new shop matched to the temp shop -> code linked in every tab; other new customer added; existing untouched
- TTX bills report (real layout): new bills, VAT line dropped + VAT_OUT, existing bill untouched, review rows in aCRM wording
- re-importing the same TTX files is refused (no duplicates) and the history page lists batches + review
- unknown file layout is rejected with a clear message (no guessing)
- offline: field note is queued locally, shown in header, then synced exactly once when back online
- app shell loads offline from cache (service worker)
- queue persists across reload before it is flushed (IndexedDB)
- domain computations at full scale stay fast
