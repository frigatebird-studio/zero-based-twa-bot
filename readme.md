# zero-based-twa-bot

## Bootstrap

follow the example and fill in the `.yaml` file in /config folder

```
npm install
```

## startup

### dev mode

```
npm run dev
```

### normal mode

```
npm run start
```

## API Usage

### POST

```
host/jetton/transfer
```

Header

```
{
  "Content-Type": "application/json"
}
```

Body

```
{
  "dest": "destination_address",
  "chatID": "chatID"
}
```
