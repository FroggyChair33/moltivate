import { fileURLToPath } from 'node:url';
import { checkRepository } from './check-repository.mjs';

checkRepository(fileURLToPath(new URL('../', import.meta.url)));
console.log('Repository guard passed.');
