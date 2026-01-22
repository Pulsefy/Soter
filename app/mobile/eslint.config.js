import expo from 'eslint-config-expo';

export default [
    ...Array.isArray(expo) ? expo : [expo],
];
