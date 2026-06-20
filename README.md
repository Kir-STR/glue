# glue

Проект из `real-tools`. Отдельный git-репозиторий со своим `.git`, что изолирует
память Claude Code: запущенный из этой папки, Claude видит корнем репозитория сам
`glue`, а не родительский vault, и ведёт собственную папку памяти.

Папка игнорируется родительским vault (`1.Projects/RnD/real-tools/*`) — это
standalone-репо, не submodule vault'а. Аналог соседнего `invoker`.
