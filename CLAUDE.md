# Hinweise für Claude

## Hilfe-Wissen aktuell halten (Pflicht)

Diese App hat den „?“-Hilfe-Knopf (`MA.hilfe(...)` aus mitarbeiter-client.js). Er antwortet nur aus
`netlify/functions/lib/hilfe-wissen.js` im Repo **mitarbeiter-api**.

Jede Änderung an der Oberfläche (neuer Knopf, Reiter, Ablauf, geänderte Beschriftung, neue Regel,
entfernte Funktion) braucht einen Begleit-PR in mitarbeiter-api, der den Abschnitt dieser App in
`hilfe-wissen.js` anpasst – Beschriftungen wörtlich, Wege als „App › Reiter › Knopf“. Im PR dieser App
auf den Begleit-PR verweisen. Details in mitarbeiter-api/CLAUDE.md.
