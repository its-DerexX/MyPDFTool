# MyPDFTool

Kleines lokales Werkzeug ohne Datenbank, SQL-Server, KI oder Hintergrund-Worker.
Es übernimmt die Formularwerte aus einem ausgefüllten PDF in das Blanko-PDF.

## Einmalige Einrichtung

Node.js installieren und im Projektordner ausführen:

```powershell
npm install
```

## Ausführen

Mit der ersten Beispiel-PDF:

```powershell
npm start
```

Mit einer konkreten PDF:

```powershell
node app.js "C:\Pfad\zu\meiner\ausgefüllten.pdf"
```

Die fertige Datei wird im Ordner `output` gespeichert. Die ursprünglichen PDFs bleiben unverändert.

## Prinzip

Das Blanko-PDF und die ausgefüllte Beispiel-PDF besitzen dieselben PDF-Formularfelder. Deshalb werden die Feldwerte direkt übertragen; eine KI oder OCR ist für diesen Workflow nicht erforderlich.
