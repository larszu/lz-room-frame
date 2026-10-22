// LZ Room Frame control for SIMPL# Pro (Crestron 4-Series, VC-4).
// Text protocol over TCP 4198, one command per line; see the app under "Steuerung".
using System;
using System.Text;
using Crestron.SimplSharp;
using Crestron.SimplSharp.CrestronSockets;

namespace LzRoomFrame
{
    public class RoomFrameClient
    {
        private readonly TCPClient _client;
        private readonly StringBuilder _rx = new StringBuilder();
        private readonly CTimer _reconnect;

        public event EventHandler<int> PersonsChanged;
        public event EventHandler<string> SceneChanged;
        public event EventHandler<string> LineReceived;
        public bool Connected { get { return _client.ClientStatus == SocketStatus.SOCKET_STATUS_CONNECTED; } }

        public RoomFrameClient(string host, int port = 4198)
        {
            _client = new TCPClient(host, port, 4096);
            _client.SocketStatusChange += (c, s) =>
            {
                if (s == SocketStatus.SOCKET_STATUS_CONNECTED) { Send("subscribe on"); c.ReceiveDataAsync(OnData); }
            };
            _reconnect = new CTimer(_ => { if (!Connected) _client.ConnectToServerAsync(null); }, null, 0, 5000);
        }

        public void Send(string line)
        {
            if (!Connected) return;
            var b = Encoding.UTF8.GetBytes(line + "\r\n");
            _client.SendData(b, b.Length);
        }

        public void Scene(int n) { Send("scene " + n); }
        public void Mode(string mode) { Send("mode " + mode); } // overview | group | people | speaker | presenter
        public void Privacy(bool on) { Send("privacy " + (on ? "on" : "off")); }
        public void Freeze(bool on) { Send("freeze " + (on ? "on" : "off")); }
        public void Zone(int n, bool on) { Send("zone " + n + " " + (on ? "on" : "off")); }

        private void OnData(TCPClient c, int n)
        {
            if (n <= 0) return;
            _rx.Append(Encoding.UTF8.GetString(c.IncomingDataBuffer, 0, n));
            string all = _rx.ToString();
            int i;
            while ((i = all.IndexOf('\n')) >= 0)
            {
                var line = all.Substring(0, i).TrimEnd('\r');
                all = all.Substring(i + 1);
                Handle(line);
            }
            _rx.Length = 0; _rx.Append(all);
            c.ReceiveDataAsync(OnData);
        }

        private void Handle(string line)
        {
            LineReceived?.Invoke(this, line);
            if (line.StartsWith("EVT persons "))
            {
                int p; if (int.TryParse(line.Substring(12), out p)) PersonsChanged?.Invoke(this, p);
            }
            else if (line.StartsWith("EVT scene ")) SceneChanged?.Invoke(this, line.Substring(10));
        }
    }
}
