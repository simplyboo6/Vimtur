const Lexer = require('./lexer.js');
const Parser = require('./shunt.js');

class AndOp {
  constructor(opA, opB) {
      this.opA = opA;
      this.opB = opB;
  }
  valid(list) {
      return this.opA.valid(list) && this.opB.valid(list);
  }
  toString() {
      return `AND(${this.opA.toString()}, ${this.opB.toString()})`;
  }
}

class OrOp {
  constructor(opA, opB) {
      this.opA = opA;
      this.opB = opB;
  }
  valid(list) {
      return this.opA.valid(list) || this.opB.valid(list);
  }
  toString() {
      return `OR(${this.opA.toString()}, ${this.opB.toString()})`;
  }
}

class NotOp {
  constructor(opA) {
      this.opA = opA;
  }
  valid(list) {
      return !this.opA.valid(list);
  }
  toString() {
      return `NOT(${this.opA.toString()})`;
  }
}

class Tag {
    constructor(tag) {
        this.tag = tag.toLowerCase();
    }
    valid(list) {
        return list.includes(this.tag) || this.tag == '*';
    }
    toString() {
        return this.tag;
    }
}

class ExpressionParser {
    constructor(input) {
        this.lexer = new Lexer();
        this.lexer.addRule(/\s+/, function () {
            /* skip whitespace */
        });

        this.lexer.addRule(/([a-zA-Z0-9]*)[^\(^\!^\&^\|^\)]+/, function (lexeme) {
            return lexeme; // symbols
        });

        this.lexer.addRule(/[\(\!\&\|\)]/, function (lexeme) {
            return lexeme; // punctuation (i.e. "(", "!", "&", "|", ")")
        });

        const invert = {
            precedence: 2,
            associativity: "left"
        }

        const action = {
            precedence: 1,
            associativity: "left"
        };

        this.parser = new Parser({
            "!": invert,
            "&": action,
            "|": action
        });

        this.parse(input);
    }

    buildTree(polish) {
        const stack = [];
        polish.forEach(function (c) {
            switch (c) {
            case "&":
                stack.push(new AndOp(stack.pop(), stack.pop()));
                break;
            case "|":
                stack.push(new OrOp(stack.pop(), stack.pop()));
                break;
            case "!":
                stack.push(new NotOp(stack.pop()));
                break;
            default:
                stack.push(new Tag(c));
                break;
            }
        });
        return stack.pop();
    }

    parse(input) {
        this.lexer.setInput(input.trim().toLowerCase());
        const tokens = [];
        let token;
        while (token = this.lexer.lex()) {
            tokens.push(token.trim().toLowerCase());
        }

        const polish = this.parser.parse(tokens);

        this.tree = this.buildTree(polish);

        try {
            this.match('');
        } catch (err) {
            throw {message: 'Invalid number of arguments detected'};
        }
    }

    match(list) {
        // Either an array of strings or a string
        if (Array.isArray(list)) {
            list = list.join(" ");
        }
        list = list.toLowerCase();
        return this.tree.valid(list);
    }

    toString() {
        return this.tree.toString();
    }
}

module.exports = ExpressionParser;
