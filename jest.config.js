module.exports = {
    verbose: true,
    "transform": {
      "^.+\\.ts?$": "ts-jest"
    },
    "testURL": "http://localhost/",
    "testRegex": "(/__tests__/.*|(\\.|/)(test|spec))\\.(js?|ts?)$",
    "moduleFileExtensions": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "json",
      "node"
    ],
    "globals": {
      "ts-jest": {
        "skipBabel": true,
        "enableTsDiagnostics": true
      },
    },
    "roots": [
      "<rootDir>/src"
    ],
};