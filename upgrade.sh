#!/bin/bash

# Install main modules
npm install

# Install plugin dependencies.
for folder in plugins/*; do
  if [ -d $folder ]; then
    cd $folder

    echo ''
    echo ''
    echo $folder

    rm -rf node_modules
    npm install
    npm audit
    npm audit fix
    cd ../..
  fi
done
