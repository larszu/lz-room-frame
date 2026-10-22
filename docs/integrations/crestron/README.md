# Crestron

LZ Room Frame hört auf **TCP 4198** (ein Befehl pro Zeile, Ende `\r\n`) und **HTTP 4197**. Dafür ist kein eigenes Modul nötig.

## SIMPL Windows

1. Symbol **TCP/IP Client** (bzw. *TCP/IP Client v2*) anlegen, IP des Rechners, Port `4198`.
2. `connect` auf High halten, damit der Client nach einem Neustart der App wieder verbindet.
3. Befehle als **Serial Send** oder **Serial I/O** an `TX$`, jeweils mit `\x0D\x0A` am Ende:

| Taste | String |
|---|---|
| Szene 1 | `scene 1\x0D\x0A` |
| Kacheln | `mode people\x0D\x0A` |
| Gruppe | `mode group\x0D\x0A` |
| Sprecher | `mode speaker\x0D\x0A` |
| Kamera aus / an | `privacy on\x0D\x0A` / `privacy off\x0D\x0A` |
| Mikro 3 offen / zu | `zone 3 on\x0D\x0A` / `zone 3 off\x0D\x0A` |

4. Rückmeldung: nach dem Verbinden `subscribe on\x0D\x0A` senden. Danach kommen Zeilen wie `EVT persons 4` und `EVT scene 2 tiles`. Mit **Serial Gather** (Trenner `\x0D\x0A`) und **Serial to Analog** bzw. einer SIMPL+-Auswertung auf das Panel legen.

## SIMPL# Pro / Crestron Home / VC-4

`LzRoomFrame.cs` ist eine kleine Klasse auf `TCPClient` mit `Scene(n)`, `Mode(…)`, `Privacy(bool)`, `Zone(n, bool)` und den Ereignissen `PersonsChanged` und `SceneChanged`.

## Touchpanel

Die Fernbedienung `http://<ip>:4197/` läuft im Web-Widget von CH5- und X-Panels; `http://<ip>:4197/preview.mjpg` liefert die Vorschau.

Ungeprüft: Weder das Symbol-Setup noch die Klasse liefen bisher auf einem Crestron-Prozessor.
