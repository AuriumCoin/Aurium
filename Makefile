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
	npm install
	npm i minify -g
	npm install --global esbuild
