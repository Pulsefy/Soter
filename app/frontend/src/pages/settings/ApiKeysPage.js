// app/frontend/src/pages/settings/ApiKeysPage.js
import React, { useState, useEffect } from 'react';
import { getKeys, rotateKey, revokeKey, createKey } from '../../services/apiKeyService';

function ApiKeysPage() {
  const [keys, setKeys] = useState([]);

  useEffect(() => {
    getKeys().then(setKeys);
  }, []);

  const handleRotate = async (id) => {
    if (window.confirm('Are you sure you want to rotate this key?')) {
      await rotateKey(id);
      setKeys(await getKeys());
    }
  };

  const handleRevoke = async (id) => {
    if (window.confirm('Are you sure you want to revoke this key?')) {
      await revokeKey(id);
      setKeys(await getKeys());
    }
  };

  const handleCreate = async () => {
    const newKey = await createKey();
    alert(`New key created: ${newKey.masked}`);
    setKeys(await getKeys());
  };

  return (
    <div>
      <h2>API Key Management</h2>
      <button onClick={handleCreate}>Create New Key</button>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Creator</th>
            <th>Created</th>
            <th>Last Used</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(k => (
            <tr key={k.id}>
              <td>{k.masked}</td>
              <td>{k.creator}</td>
              <td>{k.createdAt}</td>
              <td>{k.lastUsed}</td>
              <td>
                <button onClick={() => handleRotate(k.id)}>Rotate</button>
                <button onClick={() => handleRevoke(k.id)}>Revoke</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ApiKeysPage;
