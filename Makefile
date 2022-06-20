define main
	esbuild index.js --bundle --outfile=out.js --platform=node --external:./node_modules/*
	minify out.js > aurium.js
endef

main-win32:
	$(main)
	del out.js

main-linux:
	$(main)
	rm ./out.js

install:
	npm i
	npm i -g minify
	npm i -g esbuild
	git clone -b master https://github.com/AuriumDev/ed25519-blake2b
	cd ed25519-blake2b && npm i napi-macros node-gyp-build && npm run install
