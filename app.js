const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const ROOT = __dirname;
const TEMPLATE = fs.readdirSync(path.join(ROOT, 'templates')).map(file => path.join(ROOT, 'templates', file)).find(file => path.basename(file).startsWith('Z'));
const EXAMPLES = path.join(ROOT, 'examples');
const OUTPUT = path.join(ROOT, 'output');

function usage() {
  console.log('MyPDFTool Ã¢â‚¬â€œ Formularwerte ÃƒÂ¼bertragen');
  console.log('');
  console.log('Verwendung:');
  console.log('  node app.js "pfad\\zur\\ausgefÃƒÂ¼llten-datei.pdf"');
  console.log('');
  console.log('Ohne Argument wird automatisch die erste PDF aus examples verwendet.');
}

async function copyFormValues(sourcePath) {
  if (!fs.existsSync(TEMPLATE)) throw new Error(`Blanko-PDF fehlt: ${TEMPLATE}`);
  if (!fs.existsSync(sourcePath)) throw new Error(`Quelldatei fehlt: ${sourcePath}`);

  const source = await PDFDocument.load(fs.readFileSync(sourcePath), { ignoreEncryption: true });
  const target = await PDFDocument.load(fs.readFileSync(TEMPLATE), { ignoreEncryption: true });
  const sourceForm = source.getForm();
  const targetForm = target.getForm();
  const sourceFields = new Map(sourceForm.getFields().map(field => [field.getName(), field]));
  let copied = 0;
  let skipped = 0;

  for (const targetField of targetForm.getFields()) {
    const sourceField = sourceFields.get(targetField.getName());
    if (!sourceField) { skipped++; continue; }
    try {
      if (typeof targetField.setText === 'function' && typeof sourceField.getText === 'function') {
        const value = sourceField.getText();
        if (value !== undefined && value !== null) targetField.setText(value);
      } else if (typeof targetField.select === 'function' && typeof sourceField.getSelected === 'function') {
        const value = sourceField.getSelected();
        if (value) targetField.select(value);
      } else if (typeof targetField.check === 'function' && typeof sourceField.isChecked === 'function') {
        if (sourceField.isChecked()) targetField.check();
      }
      copied++;
    } catch (_) {
      skipped++;
    }
  }

  targetForm.updateFieldAppearances();
  fs.mkdirSync(OUTPUT, { recursive: true });
  const outputPath = path.join(OUTPUT, path.basename(sourcePath, '.pdf') + '_Zaehlerwechsel.pdf');
  fs.writeFileSync(outputPath, await target.save());
  return { outputPath, copied, skipped };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return usage();
  const requested = process.argv[2];
  const exampleFiles = fs.readdirSync(EXAMPLES).filter(file => file.toLowerCase().endsWith('.pdf'));
  const defaultExample = exampleFiles.find(file => file.toLowerCase().startsWith('pet')) || exampleFiles[0];
  const sourcePath = requested ? path.resolve(requested) : (defaultExample && path.join(EXAMPLES, defaultExample));
  if (!sourcePath) throw new Error('Keine PDF in examples gefunden.');
  const result = await copyFormValues(sourcePath);
  console.log(`Fertig: ${result.outputPath}`);
  console.log(`${result.copied} Formularfelder verarbeitet, ${result.skipped} ÃƒÂ¼bersprungen.`);
}

main().catch(error => {
  console.error(`Fehler: ${error.message}`);
  process.exitCode = 1;
});
