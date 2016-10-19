var BpmnModeler = require('bpmn-js/lib/Modeler');
var BpmnViewer = require('bpmn-js/lib/Viewer');
var propertiesPanelModule = require('bpmn-js-properties-panel');
var propertiesProviderModule = require('bpmn-js-properties-panel/lib/provider/bpmn');

module.exports = BpmnModeler;
module.exports.Viewer = BpmnViewer;
module.exports.propertiesPanelModule = propertiesPanelModule;
module.exports.propertiesProviderModule = propertiesProviderModule;

