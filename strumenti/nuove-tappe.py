"""Elenca le tappe del foglio che non hanno ancora descrizione e foto in dati/tappe.md.
Uso: python3 strumenti/nuove-tappe.py"""
import json, re, unicodedata, urllib.request
base = __file__.rsplit('/', 2)[0]
nav = open(f'{base}/nav.js').read()
url = re.search(r"FOGLIO = '([^']+)'", nav).group(1)
foglio = json.load(urllib.request.urlopen(url))
slug = lambda s: re.sub(r'[^a-z0-9]+', '-', re.sub(r'\(.*?\)', '', ''.join(c for c in unicodedata.normalize('NFD', s) if not unicodedata.combining(c)).lower())).strip('-')
scritte = set(re.findall(r'^## (\S+) —', open(f'{base}/dati/tappe.md').read(), re.M))
visti = []
for riga in foglio['giorni']:
    nome = riga[1] if len(riga) > 1 else ''
    if nome and slug(nome) not in scritte and nome not in visti: visti.append(nome)
print('\n'.join(f'{n}  →  ## {slug(n)} — {n}' for n in visti) or 'Nessuna tappa nuova.')
