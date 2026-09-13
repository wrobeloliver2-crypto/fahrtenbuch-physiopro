# Fahrtenbuch – Physio Pro Lübeck

Dienstfahrten erfassen, zur Abrechnung einreichen, in der Verwaltung genehmigen und auszahlen.

- **Daten:** Neon Postgres (Datenbank `mitarbeiter`, Tabellen `fb_fahrten`, `fb_abrechnungen`)
- **Login:** zentraler Mitarbeiter-Dienst (`mitarbeiter-api`), gleiche PIN wie im Portal und in der Zeiterfassung.
  Aus dem Portal (STUFF) geht es per Kachel ohne zweiten Login hinein (`#ma=<token>`).
- **Funktionen:** `netlify/functions/fahrten.js` (Fachlogik), `sendmail.js` (Graph-Mail), `sheet.js` (nur noch für den einmaligen Import der Altdaten)
- **Umgebungsvariablen (Netlify):** `DATABASE_URL`, `ZEIT_TOKEN_SECRET`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`

Entscheidungen der Verwaltung landen als Hinweis im persönlichen Bereich der Person (Portal / Zeiterfassung).
