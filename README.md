# Doxxo

A documentation generator inspired by [Docco](http://jashkenas.github.com/docco/). Doxxo parses block-level comments in JavaScript code to find documentation and parses them as markdown. Doxxo only supports JavaScript and Markdown files at the moment.

Check out [the Doxxo documentation](http://beneaththeink.github.io/doxxo/doxxo.html), produced with Doxxo itself!

## Installation

	npm install -g doxxo

## Usage

	Usage: doxxo [options] FILES

	FILES can be any .js or .md source file or a directory containing .js or .md
	files. Directories are only traversed a single level, unless the --recursive
	flag is enabled.

	Options:

		-h, --help             output usage information
		-v, --version          output the version number
		-o, --output [path]    use a custom output path (default: 'docs')
		-l, --layout [layout]  use a layout folder or a built-in layout ('bti',
		                       'parallel', 'classic', 'linear', 'plain-markdown')
		-t, --template [file]  use a custom .jst template
		--no-assets            do not copy layout assets into the output folder
		-r, --recursive        look in sub-directories for files
		-i, --index [file]     mark a file as the index file