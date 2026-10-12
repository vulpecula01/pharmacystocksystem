const express = require('express');
const router = express.Router();
const { requireLogin, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/adminController');

router.use(requireLogin, requireAdmin);

router.get('/stores', ctrl.listStores);
router.post('/stores', ctrl.createStore);
router.put('/stores/:id', ctrl.updateStore);

router.get('/drug-groups', ctrl.listDrugGroups);
router.post('/drug-groups', ctrl.createDrugGroup);

router.get('/drugs', ctrl.listAllDrugs);
router.post('/drugs', ctrl.createDrug);
router.put('/drugs/:id', ctrl.updateDrug);

router.get('/config', ctrl.listConfig);
router.post('/config', ctrl.upsertConfig);

router.get('/users', ctrl.listUsers);
router.get('/users/:id', ctrl.getUser);
router.post('/users', ctrl.createUser);
router.put('/users/:id', ctrl.updateUser);
router.delete('/users/:id', ctrl.deleteUser);
router.post('/users/:id/store-access', ctrl.setUserStoreAccess);

router.get('/audit-log', ctrl.listAuditLog);
router.get('/roles', ctrl.listRoles);

router.get('/lots/:id', ctrl.getLotUsage);
router.put('/lots/:id', ctrl.updateLot);

router.get('/clinics', ctrl.listClinics);
router.post('/clinics', ctrl.createClinic);
router.put('/clinics/:id', ctrl.updateClinic);

module.exports = router;
