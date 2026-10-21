const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
module.exports = defineConfig([
  expo,
  { ignores: ['dist/**', 'dist-mobile/**', '.test-build/**', '.expo/**'] },
  { files: ['tests/**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
]);
