main-win32:
	esbuild index.js --bundle --outfile=out.js --platform=node --external:./node_modules/*
	minify out.js > aurium.js
	del out.js
main-linux:
	esbuild index.js --bundle --outfile=out.js --platform=node --external:./node_modules/*
	minify out.js > aurium.js
	rm ./out.js
install:
	npm install
	npm i minify -g
	npm install --global esbuild
