# Glossary

One term per concept. The UI catalogs in `apps/web/src/i18n/messages/` use these words; a new
string reuses them instead of a synonym.

## Terms

### Transaction

One expense or income on a date, in a currency, in one workspace. The UI also says "entry" for the
same thing; translations use one word for both.

### Account

Where money sits: cash, a card, a bank account, savings. Has one currency, fixed at creation.

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

Bringing transactions in from a bank statement CSV. Imported rows wait in review until the user
picks personal or family and a category.

### Sync

Sending changes made on a device to the server and pulling others' changes back.

### Conflict

A transaction changed on this device and elsewhere before sync; the user picks a version.

### Member, owner, invitation

A family has one owner and members. The owner creates one-time invitation links.

## Translations

The register is polite "ви" in Ukrainian, polite "вы" in Russian and "tú" in Spanish (Spain).

| Concept            | en                      | uk                         | ru                          | es                     |
| ------------------ | ----------------------- | -------------------------- | --------------------------- | ---------------------- |
| transaction, entry | transaction, entry      | операція                   | операция                    | movimiento             |
| expense / income   | expense / income        | витрата / дохід            | расход / доход              | gasto / ingreso        |
| account            | account                 | рахунок                    | счёт                        | cuenta                 |
| category           | category                | категорія                  | категория                   | categoría              |
| workspace          | workspace               | простір                    | пространство                | espacio                |
| personal / family  | personal / family       | особисте / сімʼя           | личное / семья              | personal / familia     |
| budget, limit      | budget, limit           | бюджет, ліміт              | бюджет, лимит               | presupuesto, límite    |
| recurring rule     | recurring payment, rule | регулярний платіж, правило | регулярный платёж, правило  | pago recurrente, regla |
| import             | import                  | імпорт                     | импорт                      | importación            |
| statement          | bank statement          | банківська виписка         | банковская выписка          | extracto bancario      |
| review             | review                  | перевірка, перевірити      | проверка, проверить         | revisión, revisar      |
| sync               | sync                    | синхронізація              | синхронизация               | sincronización         |
| conflict           | conflict                | конфлікт                   | конфликт                    | conflicto              |
| member             | member                  | учасник                    | участник                    | miembro                |
| owner              | owner                   | власник                    | владелец                    | propietario            |
| invitation         | invitation              | запрошення                 | приглашение                 | invitación             |
| currency           | currency                | валюта                     | валюта                      | moneda                 |
| amount             | amount                  | сума                       | сумма                       | importe                |
| exchange rate      | rate                    | курс                       | курс                        | tipo de cambio         |
| archive / restore  | archive / restore       | архівувати / відновити     | архивировать / восстановить | archivar / restaurar   |
| user account       | account (sign-in)       | акаунт                     | аккаунт                     | cuenta                 |
