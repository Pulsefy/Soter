const { NestFactory } = require('@nestjs/core');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
const { AppModule } = require('../app/backend/src/app.module');
const fs = require('fs');
const path = require('path');

async function generateOpenApi() {
  const app = await NestFactory.create(AppModule);
  
  const config = new DocumentBuilder()
    .setTitle('Pulsefy/Soter API')
    .setVersion('1.0')
    .build();
    
  const document = SwaggerModule.createDocument(app, config);
  
  const outputPath = path.resolve(process.cwd(), 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));
  
  console.log(`🚀 OpenAPI specification generated at: ${outputPath}`);
  
  await app.close();
}

void generateOpenApi();
