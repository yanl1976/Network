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
    const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(out); } };
    const timer = setTimeout(finish, (session.timeout ?? 3000) * 2);
    try {
      // net-snmp 的 subtree(oid, feedCb, doneCb) 必须传第三个完成回调，
      // 否则库在数据遍历结束时会调用 req.doneCb(null) 抛 "doneCb is not a function"。
      session.subtree(oid, (varbinds) => {
        out.push(...varbinds.filter((vb) => vb && !(vb.value instanceof Error)).map((vb) => ({ oid: String(vb.oid), value: decoder(vb.value) })));
      }, finish);
    } catch {
      finish();
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

const FDB_OID = {
  dot1dPort: '1.3.6.1.2.1.17.4.3.1.2',
  dot1dAddress: '1.3.6.1.2.1.17.4.3.1.1',
  basePortIfIndex: '1.3.6.1.2.1.17.1.4.1.2',
  dot1qPort: '1.3.6.1.2.1.17.7.1.2.2.1.2',
  dot1qAddress: '1.3.6.1.2.1.17.7.1.2.2.1.1',
  ifDescr: '1.3.6.1.2.1.2.2.1.2'
};

export function normalizeMac(input) {
  const hex = String(input ?? '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  return hex.match(/../g).join(':');
}

function macOidSuffix(mac) {
  return mac.split(':').map((part) => parseInt(part, 16)).join('.');
}

export async function collectMacTable(device, snmpCfg) {
  const version = snmpCfg.version === '3' ? snmp.Version3 : snmp.Version2c;
  const options = { timeout: snmpCfg.timeout ?? 3000, retries: snmpCfg.retries ?? 1, version };
  const session = snmp.createSession(device.ip, snmpCfg.community ?? 'public', options);
  session.timeout = options.timeout;
  try {
    const [qAddr, qPort, dAddr, dPort, baseMap, descrRows] = await Promise.all([
      subtree(session, FDB_OID.dot1qAddress, macAddr),
      subtree(session, FDB_OID.dot1qPort),
      subtree(session, FDB_OID.dot1dAddress, macAddr),
      subtree(session, FDB_OID.dot1dPort),
      subtree(session, FDB_OID.basePortIfIndex),
      subtree(session, FDB_OID.ifDescr)
    ]);
    const ifIndexByPort = new Map(baseMap.map((r) => [String(r.oid).slice(FDB_OID.basePortIfIndex.length + 1), number(r.value)]));
    const portNameByIndex = new Map(descrRows.map((r) => [String(r.oid).slice(FDB_OID.ifDescr.length + 1), readable(r.value)]));
    const out = [];
    const byPort = (rows, addrRows, withVlan) => {
      const portMap = new Map(rows.map((r) => [String(r.oid).slice((withVlan ? FDB_OID.dot1qPort : FDB_OID.dot1dPort).length + 1), number(r.value)]));
      for (const r of addrRows) {
        const mac = normalizeMac(r.value);
        if (!mac) continue;
        const key = String(r.oid).slice((withVlan ? FDB_OID.dot1qAddress : FDB_OID.dot1dAddress).length + 1);
        const bridgePort = portMap.get(key);
        if (!bridgePort) continue;
        const ifIndex = ifIndexByPort.get(String(bridgePort)) || bridgePort;
        out.push({ mac, ifIndex, port: portNameByIndex.get(String(ifIndex)) || `端口 ${ifIndex}`, vlan: withVlan ? key.split('.')[0] : '', source: withVlan ? 'dot1q' : 'dot1d' });
      }
    };
    byPort(qPort, qAddr, true);
    byPort(dPort, dAddr, false);
    const seen = new Set();
    return out.filter((r) => {
      const key = `${r.mac}|${r.ifIndex}|${r.vlan}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } finally {
    session.close();
  }
}

export async function lookupMacOnDevice(device, snmpCfg, mac) {
  const version = snmpCfg.version === '3' ? snmp.Version3 : snmp.Version2c;
  const options = { timeout: snmpCfg.timeout ?? 3000, retries: snmpCfg.retries ?? 1, version };
  const session = snmp.createSession(device.ip, snmpCfg.community ?? 'public', options);
  session.timeout = options.timeout;
  try {
    const suffix = macOidSuffix(mac);
    const candidates = [
      `${FDB_OID.dot1dPort}.${suffix}`,
      `${FDB_OID.dot1qPort}.1.${suffix}`
    ];
    let bridgePort = 0;
    let source = '';
    for (const oid of candidates) {
      const value = number((await get(session, [oid]))[oid]);
      if (value > 0) { bridgePort = value; source = oid === candidates[0] ? 'dot1d' : 'dot1q'; break; }
    }
    if (!bridgePort) {
      const rows = await subtree(session, FDB_OID.dot1qAddress, macAddr);
      const hit = rows.find((r) => r.value?.toLowerCase() === mac.toLowerCase());
      if (hit) {
        const key = hit.oid.slice(FDB_OID.dot1qAddress.length + 1);
        const oid = `${FDB_OID.dot1qPort}.${key}`;
        bridgePort = number((await get(session, [oid]))[oid]);
        source = `dot1q(${key.split('.')[0]})`;
      }
    }
    if (!bridgePort) {
      const rows = await subtree(session, FDB_OID.dot1dAddress, macAddr);
      const hit = rows.find((r) => r.value?.toLowerCase() === mac.toLowerCase());
      if (hit) {
        const key = hit.oid.slice(FDB_OID.dot1dAddress.length + 1);
        const oid = `${FDB_OID.dot1dPort}.${key}`;
        bridgePort = number((await get(session, [oid]))[oid]);
        source = 'dot1d';
      }
    }
    if (!bridgePort) return { found: false, ok: true };
    const ifIndexMap = await get(session, [`${FDB_OID.basePortIfIndex}.${bridgePort}`]);
    const ifIndex = number(ifIndexMap[`${FDB_OID.basePortIfIndex}.${bridgePort}`]) || bridgePort;
    const descMap = await get(session, [`${FDB_OID.ifDescr}.${ifIndex}`]);
    const port = readable(descMap[`${FDB_OID.ifDescr}.${ifIndex}`]) || `端口 ${ifIndex}`;
    return { found: true, ok: true, port, ifIndex, bridgePort, source };
  } catch (error) {
    return { found: false, ok: false, error: error.message };
  } finally {
    session.close();
  }
}
