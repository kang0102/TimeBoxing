const fs=require('node:fs');
fs.writeFileSync('test.rules',"rules_version = '2';\nservice cloud.firestore { match /databases/{database}/documents {\n"+fs.readFileSync('portfolio.rules.fragment','utf8')+fs.readFileSync('conviction.rules.fragment','utf8')+"\n}}\n");
