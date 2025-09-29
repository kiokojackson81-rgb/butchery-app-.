# Admin smoke test (manual)

All requests are idempotent and safe to re-run.

## Outlets upsert (bulk)

curl -i -sS -H "Content-Type: application/json" --data '{"outlets":[{"name":"Baraka A","code":"A","active":true},{"name":"Baraka B","code":"B","active":true}]}' http://localhost:3000/api/admin/outlets/upsert

## People & Codes sync (bulk)

curl -i -sS -H "Content-Type: application/json" --data '{"codes":[{"name":"Alice","code":"a1","role":"attendant","active":true},{"name":"Sam","code":"sv1","role":"supervisor","active":true},{"name":"Supp","code":"su1","role":"supplier","active":true}]}' http://localhost:3000/api/admin/codes/sync

## Assignments upsert (bulk via scope)

curl -i -sS -H "Content-Type: application/json" --data '{"a1":{"outlet":"Baraka A","productKeys":["beef","goat"]}}' http://localhost:3000/api/admin/scope

## Pricebook save (example)

curl -i -sS -H "Content-Type: application/json" --data '{"scope":{},"pricebook":{"Baraka A":{"beef":{"sellPrice":700,"active":true}}}}' http://localhost:3000/api/admin/save-scope-pricebook

## Thresholds save

curl -i -sS -H "Content-Type: application/json" --data '{"thresholds":{"beef":5}}' http://localhost:3000/api/admin/low-stock-thresholds

## Phones mapping

curl -i -sS -H "Content-Type: application/json" --data '{"code":"a1","role":"attendant","phoneE164":"+254700000000","outlet":"Baraka A"}' http://localhost:3000/api/admin/phones

## Attendant login (expect Set-Cookie bk_sess)

curl -i -sS -H "Content-Type: application/json" --data '{"code":"a1"}' http://localhost:3000/api/attendant/login

## Me (use cookie from above)

curl -i -sS -H "Cookie: bk_sess=REPLACE" http://localhost:3000/api/auth/me

## Admin bootstrap

curl -i -sS http://localhost:3000/api/admin/bootstrap
