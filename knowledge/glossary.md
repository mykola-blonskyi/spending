# Glossary

One term per concept. The UI catalogs in `apps/web/src/i18n/messages/` use these words; a new
string reuses them instead of a synonym.

## Terms

### Transaction

One expense or income on a date, in a currency, in one workspace. The UI also says "entry" for the
same thing; translations use one word for both.

### Account

Where money sits: cash, a card, a bank account, savings. Has one currency, fixed at creation.
An entry with an account is in the account's currency (BR-39). Deleted only when unused,
otherwise archived (BR-41).

### Account balance

How much money is on an account now, in its currency: the opening balance plus its entries'
income minus expenses from the opening date on (all of them without one), transfer sides
included (BR-40). Computed on the
device. Not the period net.

### Opening balance

What an account held on its opening date, before the first entry the app counts ("I had 3,000 € on
1 October"). An account field, not an entry, so it never shows up as income (ADR-017). May be
negative, for a debt. Defaults to 0, with no date: then every entry counts.

### Period net

Income minus expenses over the dashboard's period, in EUR. Not a balance: "balance" is kept for
the money on an account.

### Category

A group of expense or income transactions (Groceries, Salary). Default categories show in the
reader's language until renamed.

### Workspace

The ownership boundary for ledger data. Every user has one personal workspace and may belong to
one family workspace. The UI rarely says "workspace"; it says "personal" and "family".

### Budget

A monthly EUR limit for one expense category in one workspace.

### Recurring rule

A schedule that records a transaction on every due date. The UI calls the list "recurring
payments" and one item a "rule".

### Import

Bringing transactions in from a bank statement (CSV or XLSX). Imported rows wait in review until
the user picks personal or family and a category.

### Import history

The list of past statement uploads (import batches) on the Imports page. An undone import can be
removed from it; entries do not change.

### Preset

A known bank layout (BBVA, Santander, monobank, PrivatBank) recognized by its header row; it
fills in the column mapping and formats. "Other" is any file without one.

### Header signature

The header row of a statement, normalized (lowercase, single spaces, no card currency suffix).
Presets are matched against it, and the last mapping for a file without a preset is remembered
under it on the device.

### Card currency amount

The amount in the card's or account's own currency, which is what gets imported. The operation
amount in a foreign currency, the rate, commission and cashback are not.

### Running balance check

The balance column after each row should equal the previous balance plus the row's amount. A row
that does not is shown as a warning before import; it is still imported.

### Transfer

Money moved between the user's own accounts in one space: an expense on one account and an
income on another, linked, and counted as neither (BR-37). A **one-sided transfer** has its other
side on an "own account outside the app" (uk "власний рахунок поза застосунком", ru "собственный
счёт вне приложения", es "cuenta propia fuera de la aplicación").

### Sync

Sending changes made on a device to the server and pulling others' changes back.

### Conflict

A transaction changed on this device and elsewhere before sync; the user picks a version.

### Member, owner, invitation

A family has one owner and members. The owner creates one-time invitation links.

## Translations

The register is polite "ви" in Ukrainian, polite "вы" in Russian and "tú" in Spanish (Spain).

| Concept            | en                      | uk                                 | ru                               | es                               |
| ------------------ | ----------------------- | ---------------------------------- | -------------------------------- | -------------------------------- |
| transaction, entry | transaction, entry      | операція                           | операция                         | movimiento                       |
| expense / income   | expense / income        | витрата / дохід                    | расход / доход                   | gasto / ingreso                  |
| account            | account                 | рахунок                            | счёт                             | cuenta                           |
| category           | category                | категорія                          | категория                        | categoría                        |
| workspace          | workspace               | простір                            | пространство                     | espacio                          |
| personal / family  | personal / family       | особисте / сімʼя                   | личное / семья                   | personal / familia               |
| budget, limit      | budget, limit           | бюджет, ліміт                      | бюджет, лимит                    | presupuesto, límite              |
| recurring rule     | recurring payment, rule | регулярний платіж, правило         | регулярный платёж, правило       | pago recurrente, regla           |
| import             | import                  | імпорт                             | импорт                           | importación                      |
| statement          | bank statement          | банківська виписка                 | банковская выписка               | extracto bancario                |
| card               | card                    | картка                             | карта                            | tarjeta                          |
| account balance    | balance                 | залишок                            | остаток                          | saldo                            |
| opening balance    | opening balance, date   | початковий залишок, дата відкриття | начальный остаток, дата открытия | saldo inicial, fecha de apertura |
| period net         | period net              | підсумок періоду                   | итог периода                     | neto del periodo                 |
| skipped row        | skipped row             | пропущений рядок                   | пропущенная строка               | fila omitida                     |
| review             | review                  | перевірка, перевірити              | проверка, проверить              | revisión, revisar                |
| sync               | sync                    | синхронізація                      | синхронизация                    | sincronización                   |
| transfer           | transfer                | переказ                            | перевод                          | transferencia                    |
| other side         | other side              | друга сторона                      | вторая сторона                   | otro lado                        |
| conflict           | conflict                | конфлікт                           | конфликт                         | conflicto                        |
| member             | member                  | учасник                            | участник                         | miembro                          |
| owner              | owner                   | власник                            | владелец                         | propietario                      |
| invitation         | invitation              | запрошення                         | приглашение                      | invitación                       |
| currency           | currency                | валюта                             | валюта                           | moneda                           |
| amount             | amount                  | сума                               | сумма                            | importe                          |
| exchange rate      | rate                    | курс                               | курс                             | tipo de cambio                   |
| archive / restore  | archive / restore       | архівувати / відновити             | архивировать / восстановить      | archivar / restaurar             |
| user account       | account (sign-in)       | акаунт                             | аккаунт                          | cuenta                           |
