#!/usr/bin/env python3
"""Regenerates docs/TESTS.md from the test files. For the E2E list, run `npm run test:e2e` first (uses test/e2e/out/report.json)."""
import re, glob, json, os
out = ["# รายการทดสอบทั้งหมด (สร้างจากโค้ดจริง)\n", "สร้างใหม่ด้วย `python3 scripts/gen-tests-doc.py` หลังรัน `npm run test:e2e`\n"]
tot = 0
for f in sorted(glob.glob('test/unit/*.test.js')):
    ns = re.findall(r"^test\(\s*(['\"`])(.+?)\1", open(f, encoding='utf-8').read(), re.M)
    out.append(f"\n## หน่วย · {f} ({len(ns)})\n"); tot += len(ns); out += [f"- {n[1]}" for n in ns]
rn = re.findall(r"^test\('(.+?)',", open('test/real/real.test.js', encoding='utf-8').read(), re.M)
out.append(f"\n## ข้อมูลจริง · test/real/real.test.js ({len(rn)}) — รันเมื่อกำหนด REAL_DIR เท่านั้น\n"); out += [f"- {n}" for n in rn]
rp = 'test/e2e/out/report.json'
if os.path.exists(rp):
    names = [x['name'] for x in json.load(open(rp))['results']]
    out.append(f"\n## E2E มือถือ 390px · test/e2e/run.mjs ({len(names)})\n"); out += [f"- {n}" for n in names]
open('docs/TESTS.md', 'w', encoding='utf-8').write("\n".join(out) + "\n")
print('unit', tot, 'real', len(rn))
