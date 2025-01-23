import { TypeScriptGenerator, TS_DESCRIPTION_PRESET } from '@asyncapi/modelina';
import { writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';

const OUTPUT_DIR = './src/types/api';
const WARNING = '// This file is generated. Do not modify it manually.\n';

(async () => {
  if (existsSync(OUTPUT_DIR)) rmSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR);
  const req = await fetch('http://localhost:4000/swagger-json');
  const {schemas} = (await req.json()).components;
  const generator = new TypeScriptGenerator({
    presets: [TS_DESCRIPTION_PRESET],
    rawPropertyNames: true,
    modelType: 'interface',
    processorOptions: {
      interpreter: {
        ignoreAdditionalProperties: true,
      },
    },
  });
  for (const key of Object.keys(schemas)) {
    console.log(`Generating ${key}...`);
    const models = await generator.generateCompleteModels({
      "$schema": "http://json-schema.org/draft-07/schema#",
      ...schemas[key],
      title: key,
      definitions: schemas.definitions,
    }, {
      exportType: 'named'
    });
    for (const model of models) {
      writeFileSync(`${OUTPUT_DIR}/${key}.ts`, WARNING + String(model.result));
    }
  }
  console.log('Creating index file...');
  writeFileSync(
    `${OUTPUT_DIR}/index.ts`,
    WARNING
    + '\n'
    + Object
      .keys(schemas)
      .map(key => `export * from './${key}';`)
      .join('\n')
    + '\n'
  );
  console.log('Done!');
})();
