# Book currency

Each organization ("book") keeps all its amounts in one currency, USD unless
set otherwise. Amounts show with that currency's symbol and decimals: none
for KRW or JPY, for example.

An owner sets it under **Settings → Currency** while the book is empty. Once
anything has been booked or imported, the currency can't change: it would
relabel every amount without converting any.

## Accounts in another currency

Inside a book, a bank account, card or loan can be kept in another
currency: give it one when you add it (assets and liabilities only). Each
journal line on it says how much of that currency moved and at what rate;
the debit or credit is the book-currency amount, so every report still adds
up in the book's currency. **Reports → Foreign Currency Balances** shows
each such account's balance in its own currency and what the books carry it
at, and books a revaluation to a rate you give (or the exchange-rates
plugin's quote) against an exchange gain or loss account.

A bank feed or statement import on such an account brings its rows in in
the account's own currency, each with the rate it will be booked at (the
book's currency per unit of the account's): the exchange-rates plugin's
quote when it has one. On **Bank Transactions** each such row shows its
amount in both currencies, and its rate can be set (when there was no
quote) or changed until it's booked. Categorizing, splitting, rules and
transfers then book it like any other row: the bank line keeps its amount
in the account's currency, and every amount is converted at the row's rate.
A row with no rate can't be booked until it has one.

## Between books

Nothing converts between books. Keep money held in another country in a book
of its own, in that country's currency, and record what moves between books
in each book at the amount it shows there. A household's net worth adds in
the equity of its owner's businesses only when they're kept in the same
currency as the household.

Tax lines, Schedules and Form 1040 are US forms, and their reports show
whatever the book's currency is; they don't convert to dollars.
