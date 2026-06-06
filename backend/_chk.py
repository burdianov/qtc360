import httpx
BASE = "http://127.0.0.1:50000/api/v1"
r = httpx.post(f"{BASE}/auth/login", json={"email":"site@jlwme.com","password":"Site1234"})
h = {"Authorization": f"Bearer {r.json()['access_token']}"}
r = httpx.get(f"{BASE}/commissioning/asset-requirements", params={"project_id":"61de59c0-eb71-42ad-90f4-81f561c80ac1"}, headers=h)
ars = r.json()
seen = {}
for ar in ars:
    key = (ar["asset_id"], ar["requirement_template_id"])
    seen.setdefault(key, []).append(ar["id"])
dupes = {k: v for k, v in seen.items() if len(v) > 1}
print(f"Total ARs: {len(ars)}, Duplicates: {len(dupes)}")
for k, v in dupes.items():
    print(f"  asset={k[0][:8]} tmpl={k[1][:8]} -> {len(v)} entries: {v}")
