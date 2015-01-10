# Doxxo

Doxxo is a quick-and-dirty documentation generator inspired by [Docco](http://jashkenas.github.com/docco/). Unlike Docco, Doxxo parses block-level comments to find documentation.

Doxxo only supports JavaScript at the moment.

Check out [the Doxxo documentation](http://beneaththeink.github.io/doxxo/doxxo.html), produced with Doxxo itself!

## Installation

	npm install -g doxxo

## Usage

	doxxo [options] FILES

Options:

	-h, --help             output usage information
	-V, --version          output the version number
	-l, --layout [layout]  choose a built-in layouts (parallel, linear)
	-c, --css [file]       use a custom css file
	-o, --output [path]    use a custom output path
	-t, --template [file]  use a custom .jst template
	-m, --marked [file]    use custom marked options