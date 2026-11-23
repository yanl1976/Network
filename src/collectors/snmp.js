import snmp from 'net-snmp';

export const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysObjectId: '1.3.6.1.2.1.1.2.0',
  ifDescr: '1.3.6.1.2.1.2.2.1.2',
  ifSpeed: '1.3.6.1.2.1.2.2.1.5',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifInOctets: '1.3.6.1.2.1.2.2.1.10',
  ifOutOctets: '1.3.6.1.2.1.2.2.1.16',
  lldpRemChassis: '1.0.8802.1.1.2.1.4.1.1.5',
  lldpRemPortId: '1.0.8802.1.1.2.1.4.1.1.7',
  lldpRemPortDesc: '1.0.8802.1.1.2.1.4.1.1.8',
  lldpRemSysName: '1.0.8802.1.1.2.1.4.1.1.12',
  h3cCpu: '1.3.6.1.4.1.25506.2.6.1.1.1.1.6',
  h3cMem: '1.3.6.1.4.1.25506.2.6.1.1.1.1.8',
  hrProcessorLoad: '1.3.6.1.2.1.25.3.3.1.2'
};

function readable(value) {
  if (value === null || value === undefined) return '';
  if (Buffer.isBuffer(value)) return value.toString('utf8').replace(/\0/g, '').trim();
  if (value instanceof Error) return '';
  return String(value);
}

function macAddr(value) {
  if (Buffer.isBuffer(value) && value.length === 6) return value.toString('hex').match(/../g).join(':');
  return readable(value);
}

function number(value) {
  const n = Number(readable(value));
  return Number.isFinite(n) ? n : 0;
}

function get(session, oids) {
  return new Promise((resolve) => {
    session.get(oids, (error, varbinds) => {
      if (error) return resolve({});
      const out = {};
      varbinds.forEach((vb, i) => {
        out[oids[i]] = vb && vb.value instanceof Error ? '' : readable(vb?.value);
      });
      resolve(out);
    });
  });
}

function subtree(session, oid, decoder = readable) {
  return new Promise((resolve) => {
    const out = [];
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(out); } }, (session.timeout ?? 3000) * 2);
    try {
      session.subtree(oid, (varbinds) => {
        out.push(...varbinds.filter((vb) => vb && !(vb.value instanceof Error)).map((vb) => ({ oid: String(vb.oid), value: decoder(vb.value) })));
        if (!settled) { settled = true; clearTimeout(timer); resolve(out); }
      });
    } catch {
      clearTimeout(timer);
      resolve(out);
    }
  });
}

function bySuffix(rows, oidBase) {
  const map = new Map();
  for (const row of rows) {
    const idx = row.oid.startsWith(oidBase + '.') ? row.oid.slice(oidBase.length + 1) : null;
    if (idx) map.set(idx, row.value);
  }
  return map;
}

function lldpKey(oid, oidBase) {
  const tail = oid.slice(oidBase.length + 1).split('.');
  return tail.length >= 3 ? tail.slice(-3).join('.') : null;
}

function lldpByKey(rows, oidBase) {
  const map = new Map();
  for (const row of rows) {
    const key = lldpKey(row.oid, oidBase);
    if (key) map.set(key, row.value);
  }
  return map;
}

function formatUptime(hundredths) {
  const total = Math.floor(number(hundredths) / 100);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return d > 0 ? `${d}天${h}小时` : `${h}小时${m}分`;
}

export async function collectSnmp(device, snmpCfg) {
  const version = snmpCfg.version === '3' ? snmp.Version3 : snmp.Version2c;
  const options = { timeout: snmpCfg.timeout ?? 3000, retries: snmpCfg.retries ?? 1, version };
  const session = snmp.createSession(device.ip, snmpCfg.community ?? 'public', options);
  session.timeout = options.timeout;

  try {
    const sys = await get(session, [OID.sysDescr, OID.sysName, OID.sysUpTime]);
    const [cpuRows, memRows, cpuStdRows, descrRows, speedRows, operRows, inRows, outRows,
      remChassis, remPortId, remPortDesc, remSysName] = await Promise.all([
      subtree(session, OID.h3cCpu), subtree(session, OID.h3cMem), subtree(session, OID.hrProcessorLoad),
      subtree(session, OID.ifDescr), subtree(session, OID.ifSpeed), subtree(session, OID.ifOperStatus),
      subtree(session, OID.ifInOctets), subtree(session, OID.ifOutOctets),
      subtree(session, OID.lldpRemChassis, macAddr), subtree(session, OID.lldpRemPortId),
      subtree(session, OID.lldpRemPortDesc), subtree(session, OID.lldpRemSysName)
    ]);

    const firstValue = (rows, fallback = 0) => {
      const hit = rows.find((r) => number(r.value) > 0);
      return hit ? Math.min(100, number(hit.value)) : fallback;
    };
    const cpu = firstValue(cpuRows) || firstValue(cpuStdRows);
    const memory = firstValue(memRows);

    const descr = bySuffix(descrRows, OID.ifDescr);
    const speed = bySuffix(speedRows, OID.ifSpeed);
    const oper = bySuffix(operRows, OID.ifOperStatus);
    const inOct = bySuffix(inRows, OID.ifInOctets);
    const outOct = bySuffix(outRows, OID.ifOutOctets);

    const interfaces = [...descr.entries()].map(([ifIndex, name]) => {
      const bps = number(speed.get(ifIndex));
      const inBytes = number(inOct.get(ifIndex));
      const outBytes = number(outOct.get(ifIndex));
      const maxBps = bps || 1000000000;
      return {
        ifIndex: Number(ifIndex.split('.').pop()),
        name,
        descr: name,
        speed: bps,
        operStatus: number(oper.get(ifIndex)) === 1 ? 1 : 2,
        inOctets: inBytes,
        outOctets: outBytes,
        inUtil: Math.min(100, (inBytes * 8 / maxBps) * 100 / 60),
        outUtil: Math.min(100, (outBytes * 8 / maxBps) * 100 / 60)
      };
    });

    const chassis = lldpByKey(remChassis, OID.lldpRemChassis);
    const portId = lldpByKey(remPortId, OID.lldpRemPortId);
    const portDesc = lldpByKey(remPortDesc, OID.lldpRemPortDesc);
    const sysName = lldpByKey(remSysName, OID.lldpRemSysName);
    const neighbors = [...chassis.entries()].map(([key, value]) => ({
      remoteChassis: value,
      localPort: portId.get(key) || portDesc.get(key) || '',
      remotePort: portDesc.get(key) || portId.get(key) || '',
      remoteSysName: sysName.get(key) || ''
    }));

    return {
      ok: true,
      hostname: sys[OID.sysName] || device.name,
      sysDescr: sys[OID.sysDescr] || '',
      model: inferModel(sys[OID.sysDescr], device.model),
      uptime: formatUptime(sys[OID.sysUpTime]),
      cpu,
      memory,
      interfaces,
      neighbors
    };
  } finally {
    session.close();
  }
}

function inferModel(sysDescr, fallback) {
  const text = (sysDescr || '').toUpperCase();
  const match = text.match(/S\d{4}[A-Z\-]*|MSR\d{4}|F\d{3}[A-Z0-9\-]*/);
  return match ? `H3C ${match[0]}` : fallback || 'H3C 设备';
}
