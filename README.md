# AURA: Цифровой рудник «Актогай» на платформе OpenEgiz

> Цифровой двойник открытого медного карьера «Актогай» (KAZ Minerals) для открытого конкурса «Цифровой рудник на OpenEgiz».
> Команда: **AURA** (Участник: `@AURA-afk-lang`).

## Быстрый запуск на Стенде

Решение развертывается и запускается в изолированном судейском окружении Ubuntu 24.04 последовательным выполнением команд:

```bash
# 1. Установка утилит make и curl (если отсутствуют в базовом образе)
sudo apt update && sudo apt install -y make curl

# 2. Поднятие платформы OpenEgiz (Eclipse Ditto, InfluxDB, Grafana, Mosquitto)
make up

# 3. Запуск цифрового двойника Актогай (создание вещей в Ditto, симулятор, 3D-сцена)
make aktogay-start
```

После запуска:
- **Интерактивная 3D-визуализация карьера с пультом What-If:** `http://localhost:5000`
- **Дашборды управления и аналитики в Grafana:** `http://localhost:3000` (логин и сгенерированный пароль печатаются при выполнении `make up`; путь: *Dashboards → OpenEgiz Examples → Цифровой рудник «Актогай» (Team AURA)*).
- **REST API сценариев «Что-Если»:** `http://localhost:5000/api/whatif/{ex1-fail|road-block|dilution|reset}`
- **Текущее состояние и телеметрия в JSON:** `http://localhost:5000/api/state`

---

## Структура репозитория

| Путь | Содержимое |
|---|---|
| `SUBMISSION.md` | Официальное описание решения: Замысел, Модель, Модули, Сценарии «Что если», Данные |
| `presentation.pdf` | Презентация решения |
| `ROADMAP.md` | Паспорт проекта и этапы разработки |
| `team/` | Исходный код цифрового двойника Актогай (симулятор, Three.js 3D-сцена, API сценариев) |
| `team/twins.json` | Спецификация цифровых двойников для Eclipse Ditto |
| `team/setup_twins.py` | Скрипт инициализации иерархии вещей в Ditto |
| `team/simulator.py` | Физический симулятор карьера с алгоритмом шихтовки руды |
| `team/web/` | 3D WebGL сцена карьера на Three.js |
| `OPENEGIZ.ru.md` | Документация платформы OpenEgiz v1.0.4 |

---

## Контакты / Contacts

- **Автор / Участник:** Даулет Шамыран (Daulet Shamyran)
- **Студент:** 3 курс, Кафедра криптографии и информационной безопасности (группа СИБ 24-05)
- **GitHub:** [`@AURA-afk-lang`](https://github.com/AURA-afk-lang)
- **Telegram:** [@w_qawqw](https://t.me/w_qawqw)
- **Телефон / WhatsApp:** [+7 771 238 41 35](https://wa.me/77712384135)
- **Email:** [shamyrandaulett@gmail.com](mailto:shamyrandaulett@gmail.com)

---

## Лицензия

Код решения распространяется под лицензией MIT.  
Copyright (c) 2026 Team AURA (AURA-afk-lang).  
Created by Daulet Shamyran (3rd-year IT student, Dept. of Cryptography and Information Security, Group SIB 24-05).
