/**
 * # Doxxo
 *
 * A quick-and-dirty documentation generator inspired by [Docco](http://jashkenas.github.com/docco/). Unlike Docco, Doxxo parses block-level comments to find documentation, leaving inline comments where they belong.
 *
 * This file is mostly a direct translation of the [Docco source](https://github.com/jashkenas/docco/blob/c95b417df9adca5bae029b20ea7499cc28739275/docco.litcoffee), which is licensed under MIT.
 *
 *     Copyright (c) 2009-2013 Jeremy Ashkenas  
 *     Copyright (c) 2014 Beneath the Ink, Inc.  
 *     MIT License
 */

// dependencies
var _ = require('underscore'),
	fs = require('fs-extra'),
	path = require('path'),
	marked = require('marked'),
	commander = require('commander'),
	highlightjs = require('highlight.js'),
	dox = require("dox");

// default option values
var defaults = {
	layout:     'parallel',
	output:     'docs',
	template:   null,
	css:        null,
    marked:     null
};

// export all the methods
var Doxxo = module.exports = {
	version: require('../package.json').version,
	
	/**
	 * ### run()
	 *
	 * This defines the interface that Doxxo uses to run from the command line. Options are parsed using [Commander](https://github.com/visionmedia/commander.js) and passed to `Doxxo.document()`.
	 *
	 * #### Arguments
	 *
	 * - **args** _array; optional_ - An array of command line arguments to parse for options. Defaults to `process.argv`.
	 */
	run: function run(args) {
		args = args || process.argv;
		
		commander.version(Doxxo.version)
			.usage('[options] files')
			.option('-l, --layout [name]',    'choose a layout (parallel, linear or classic)', defaults.layout)
			.option('-o, --output [path]',    'output to a given folder', defaults.output)
			.option('-c, --css [file]',       'use a custom css file', defaults.css)
			.option('-t, --template [file]',  'use a custom .jst template', defaults.template)
			.option('-m, --marked [file]',    'use custom marked options', defaults.marked)
			.parse(args)
			.name = "doxxo"

		if (commander.args.length) Doxxo.document(commander);
		else console.log(commander.helpInformation());
	},
	
	/**
	 * ### document()
	 *
	 * Generates the documentation for our configured source file by copying over static assets, reading all the source files in, splitting them up into prose+code sections, highlighting each file, and printing them out in an HTML template.
	 *
	 * #### Arguments
	 *
	 * - **options** _object; optional_ - An object of options to configure this run of Doxxo.
	 *   - **config.sources** _array_ - An array of paths to JavaScript files, relative to the current working directory.
	 *   - **config.output** _string_ - The path to a folder that generated files will be saved in.
	 *   - **config.layout** _string_ - The name of the built-in layout to use. Valid values are `parallel`, `linear`, `classic` or `plain-markdown`.
	 *   - **config.marked** _object_ - Options to configure the markdown parser and renderer.
	 *   - **config.template** _string_ - A path to an Underscore style template file.
	 *   - **config.css** _string_ - A path to a CSS file to use for styling.
	 * - **callback** _function; optional_ - A function that is called when process is complete. If an error occurs, callback will be given the Error object as an argument.
	 */
	document: function document(options, callback) {
		var config = Doxxo.configure(options || {});

		fs.mkdirs(config.output, function() {
			if (callback == null) {
				callback = function(err) { if (err) throw err; }
			}

			var files = config.sources.slice();
			nextFile();
			
			function copyAsset(file, callback) {
				if (!fs.existsSync(file)) return callback();
				fs.copy(file, path.join(config.output, path.basename(file)), callback);
			}
			
			function complete() {
				copyAsset(config.css, function(error) {
					if (error) return callback(error);
					if (fs.existsSync(config.public)) return copyAsset(config.public, callback);
					callback();
				});
			}

			function nextFile() {
				var source = files.shift();

				fs.readFile(source, function(error, buffer) {
					if (error) return callback(error);

					var code = buffer.toString();
					var sections = Doxxo.parse(source, code, config);
					Doxxo.format(source, sections, config);
					Doxxo.write(source, sections, config);
					
					if (files.length) nextFile();
					else complete();
				});
			}
		});
	},
	
	/**
	 * ### parse()
	 *
	 * Given a string of source code, parse out each block-level comment and the code that follows it. This is accomplished using [Dox](https://github.com/tj/dox). An individual *section* is created for each comment and code. Each section is an object with `docsText` and `codeText` properties, and eventually `docsHtml` and `codeHtml` as well.
	 *
	 * #### Arguments
	 *
	 * - **source** _string_ - A path to a JavaScript file.
	 * - **code** _string_ - A chunk of raw JavaScript source code.
	 */
	parse: function parse(source, code) {
		var comments = dox.parseComments(code, { raw: true });
		if (!comments.length) return [];

		var lines = code.split("\n");

		var sections = [{
			codeText: lines.slice(0, comments[0].line - 1).join('\n'),
			docsText: ''
		}];

		var comment, nextComment, codeEnd, code;

		for (var i = 0; i < comments.length; i++) {
			comment = comments[i];
			nextComment = comments[i + 1];
			codeEnd = nextComment != null ? nextComment.line - 1 : lines.length;
			code = lines.slice(comment.codeStart - 1, codeEnd);

			// replace tabs with 4 spaces
			code = code.map(function(line) {
				return line.replace(/^\t+/, function(m) {
					return _.times(m.length, function() { return "    "; }).join("");
				});
			});

			sections.push({
				docsText: comment.description.full,
				codeText: code.join("\n")
			});
		}

		return sections;
	},
	
	/**
	 * ### format()
	 *
	 * Parsed sections of code are sent here to be formatted and highlighted. [Highlight.js](https://highlightjs.org) is used to highlight the code and the corresponding comments are run through Markdown, using [Marked](https://github.com/chjj/marked).
	 *
	 * #### Arguments
	 *
	 * - **source** _string_ - A path to a JavaScript file.
	 * - **sections** _array_ - An array of sections returned from `Doxxo.parse()`.
	 * - **config** _object; optional_ - An object of options to use during formatting.
	 *   - **config.marked** _object_ - Options to configure the markdown output. This value is passed directly `marked()`. The default value is `{ smartypants: true }`.
	 */
	format: function format(source, sections, config) {
		var markedOptions = _.clone(config.marked || { smartypants: true });

		_.defaults(markedOptions, {
			highlight: function(code, lang) {
				if (highlightjs.getLanguage(lang)) {
					return highlightjs.highlight(lang, code).value;
				} else {
					return code;
				}
			}
		});

		_.each(sections, function(section) {
			var code = highlightjs.highlight("javascript", section.codeText).value;
			code = code.replace(/\s+$/, '');
			section.codeHtml = "<div class='highlight'><pre>" + code + "</pre></div>";
			section.docsHtml = marked(section.docsText, markedOptions);
		});
	},
	
	/**
	 * ### write()
	 *
	 * Once all of the code has finished highlighting, the resulting documentation file is written by passing the completed HTML sections into the template, and rendering it to the specified output path.
	 *
	 * The title of the file is either the first heading in the prose, or the name of the source file.
	 *
	 * #### Arguments
	 *
	 * - **source** _string_ - A path to a JavaScript file.
	 * - **sections** _array_ - An array of sections returned from `Doxxo.parse()`.
	 * - **config** _object; optional_ - An object of options to use during writing.
	 *   - **config.output** _string_ - The path to a folder, relative to the current working directory, that generated files will be saved to.
	 *   - **config.template** _function_ - A function that should produce HTML when executed. It is given various data needed to generate the content. Follows the same API as functions outputted from `_.template()`.
	 *   - **config.css** _string_ - The name of the css file to reference in the HTML `<head>`.
	 */
	write: function write(source, sections, config) {
		var firstSection, first, hasTitle, html;

		function destination(file) {
			return path.join(config.output, path.basename(file, path.extname(file)) + '.html');
		}

		firstSection = _.find(sections, function(section) {
			return section.docsText.length > 0
		});

		if (firstSection) first = marked.lexer(firstSection.docsText)[0];
		hasTitle = first && first.type === 'heading' && first.depth === 1;

		html = config.template({
			sources: config.sources,
			css: path.basename(config.css),
			title: hasTitle ? first.text : path.basename(source),
			hasTitle: hasTitle,
			sections: sections,
			path: path,
			destination: destination
		});

		console.log("doxxo: %s -> %s", source, destination(source));
		fs.writeFileSync(destination(source), html);
	},
	
	/**
	 * ### configure()
	 *
	 * This methods parses options given to Doxxo. We might use a passed-in external template, or one of the built-in *layouts*.
	 *
	 * The user is able to override the layout file used with the `--template` parameter. In this case, it is also necessary to explicitly specify a stylesheet file. These custom templates are compiled exactly like the predefined ones, but the `public` folder is only copied for the latter.
	 *
	 * #### Arguments
	 *
	 * - **options** _object; optional_ - An object of options to configure this run of Doxxo.
	 */
	configure: function configure(options) {
		var config = _.extend({}, defaults, _.pick(options, _.keys(defaults)));

		if (options.template) {
			if (!options.css) console.warn("docco: no stylesheet file specified");
			config.layout = null;
		} else {
			var dir = config.layout = path.resolve(__dirname, '../layouts', config.layout);
			if (fs.existsSync(path.join(dir, 'public'))) config.public = path.join(dir, 'public');
			config.template = path.join(dir, 'docco.jst');
			config.css = options.css || path.join(dir, 'docco.css');
		}

		config.template = _.template(fs.readFileSync(config.template).toString());

		if (options.marked) {
			config.marked = _.isString(options.marked) ? JSON.parse(fs.readFileSync(options.marked)) : options.marked;
		}

		config.sources = options.args.sort();

		return config;
	}
};
